import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DecisionStatus } from "../../intelligence/decision/types";
import { buildKoriDecision } from "../../intelligence/testing/fixtures";
import type { SavedDecisionRecord } from "../../persistence/types";
import { approveDecision, executeDecision, recordAdvisorOverride, rejectDecision } from "../decision-workflows";
import { DecisionNotFoundError, InvalidDecisionStatusTransitionError } from "../errors";
import { createFakeTransactionRunner, type FakeStore } from "./fakes";

function seedDecision(store: FakeStore, status: DecisionStatus = "PROPOSED"): SavedDecisionRecord {
  const decision = buildKoriDecision({ status });
  const saved: SavedDecisionRecord = {
    id: randomUUID(),
    businessId: "biz-1",
    conversationId: decision.metadata.conversationId,
    conversationSnapshotId: null,
    decision,
    createdAt: new Date(),
  };
  store.decisions.set(saved.id, saved);
  return saved;
}

describe("decision workflows — valid transitions", () => {
  it("5. approveDecision: PROPOSED -> APPROVED, appends an APPROVED event", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "PROPOSED");

    const result = await approveDecision({ decisionRecordId: seeded.id, note: "Looks good" }, { transactionRunner: runner });

    expect(result.decision.decision.status).toBe("APPROVED");
    expect(result.event.eventType).toBe("APPROVED");
    expect(result.event.note).toBe("Looks good");
    expect(store.decisions.get(seeded.id)?.decision.status).toBe("APPROVED");
    expect(store.decisionEvents.size).toBe(1);
  });

  it("6. rejectDecision: PROPOSED -> REJECTED, appends a REJECTED event", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "PROPOSED");

    const result = await rejectDecision({ decisionRecordId: seeded.id }, { transactionRunner: runner });

    expect(result.decision.decision.status).toBe("REJECTED");
    expect(result.event.eventType).toBe("REJECTED");
    expect(store.decisions.get(seeded.id)?.decision.status).toBe("REJECTED");
  });

  it("rejectDecision also allows APPROVED -> REJECTED (advisor reverses before executing)", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "APPROVED");

    const result = await rejectDecision({ decisionRecordId: seeded.id }, { transactionRunner: runner });

    expect(result.decision.decision.status).toBe("REJECTED");
  });

  it("7. executeDecision: APPROVED -> EXECUTED, appends an EXECUTED event", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "APPROVED");

    const result = await executeDecision({ decisionRecordId: seeded.id }, { transactionRunner: runner });

    expect(result.decision.decision.status).toBe("EXECUTED");
    expect(result.event.eventType).toBe("EXECUTED");
  });

  it("approveDecision can optionally record an AdvisorAction alongside the transition", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "PROPOSED");

    const result = await approveDecision(
      { decisionRecordId: seeded.id, advisorAction: { actionType: "FOLLOWED_RECOMMENDATION", advisorUserId: "user-1" } },
      { transactionRunner: runner },
    );

    expect(result.advisorAction?.actionType).toBe("FOLLOWED_RECOMMENDATION");
    expect(result.advisorAction?.advisorUserId).toBe("user-1");
    expect(store.advisorActions.size).toBe(1);
  });

  it("approveDecision without an advisorAction input records none", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "PROPOSED");

    const result = await approveDecision({ decisionRecordId: seeded.id }, { transactionRunner: runner });

    expect(result.advisorAction).toBeUndefined();
    expect(store.advisorActions.size).toBe(0);
  });
});

describe("decision workflows — 9. recordAdvisorOverride", () => {
  it("1. persists both an AdvisorAction and an ADVISOR_OVERRIDDEN event, and resolves the decision as OVERRIDDEN", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "PROPOSED");

    const result = await recordAdvisorOverride(
      {
        decisionRecordId: seeded.id,
        actionType: "CUSTOM_ACTION",
        advisorUserId: "user-1",
        notes: "Called instead of texting.",
      },
      { transactionRunner: runner },
    );

    expect(result.decision.decision.status).toBe("OVERRIDDEN");
    expect(result.event.eventType).toBe("ADVISOR_OVERRIDDEN");
    expect(result.advisorAction).toBeDefined();
    expect(result.advisorAction?.actionType).toBe("CUSTOM_ACTION");
    expect(result.advisorAction?.advisorUserId).toBe("user-1");
    expect(result.advisorAction?.notes).toBe("Called instead of texting.");
    expect(store.advisorActions.size).toBe(1);
    expect(store.decisionEvents.size).toBe(1);
  });

  it("2. no longer becomes REJECTED — OVERRIDDEN and REJECTED are distinct terminal states", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "PROPOSED");

    const result = await recordAdvisorOverride(
      { decisionRecordId: seeded.id, actionType: "IGNORED_RECOMMENDATION" },
      { transactionRunner: runner },
    );

    expect(result.decision.decision.status).not.toBe("REJECTED");
    expect(result.decision.decision.status).toBe("OVERRIDDEN");
    expect(store.decisions.get(seeded.id)?.decision.status).toBe("OVERRIDDEN");
  });

  it("also works from APPROVED (advisor deviates after approving, before executing)", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "APPROVED");

    const result = await recordAdvisorOverride(
      { decisionRecordId: seeded.id, actionType: "IGNORED_RECOMMENDATION" },
      { transactionRunner: runner },
    );

    expect(result.decision.decision.status).toBe("OVERRIDDEN");
    expect(result.event.eventType).toBe("ADVISOR_OVERRIDDEN");
  });
});

describe("decision workflows — 8. invalid transitions are rejected without writes", () => {
  it("REJECTED -> EXECUTED is invalid", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "REJECTED");

    await expect(executeDecision({ decisionRecordId: seeded.id }, { transactionRunner: runner })).rejects.toBeInstanceOf(
      InvalidDecisionStatusTransitionError,
    );

    expect(store.decisions.get(seeded.id)?.decision.status).toBe("REJECTED");
    expect(store.decisionEvents.size).toBe(0);
  });

  it("CANCELLED -> APPROVED is invalid", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "CANCELLED");

    await expect(approveDecision({ decisionRecordId: seeded.id }, { transactionRunner: runner })).rejects.toBeInstanceOf(
      InvalidDecisionStatusTransitionError,
    );

    expect(store.decisions.get(seeded.id)?.decision.status).toBe("CANCELLED");
    expect(store.decisionEvents.size).toBe(0);
  });

  it("EXECUTED -> APPROVED is invalid — EXECUTED is terminal (mirrors EXECUTED -> PROPOSED being invalid)", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "EXECUTED");

    await expect(approveDecision({ decisionRecordId: seeded.id }, { transactionRunner: runner })).rejects.toBeInstanceOf(
      InvalidDecisionStatusTransitionError,
    );

    expect(store.decisions.get(seeded.id)?.decision.status).toBe("EXECUTED");
    expect(store.decisionEvents.size).toBe(0);
  });

  it("OVERRIDDEN -> APPROVED is invalid — OVERRIDDEN is terminal", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "OVERRIDDEN");

    await expect(approveDecision({ decisionRecordId: seeded.id }, { transactionRunner: runner })).rejects.toBeInstanceOf(
      InvalidDecisionStatusTransitionError,
    );

    expect(store.decisions.get(seeded.id)?.decision.status).toBe("OVERRIDDEN");
    expect(store.decisionEvents.size).toBe(0);
  });

  it("throws DecisionNotFoundError for an unknown decisionRecordId, before any write", async () => {
    const { runner, store } = createFakeTransactionRunner();

    await expect(
      approveDecision({ decisionRecordId: "does-not-exist" }, { transactionRunner: runner }),
    ).rejects.toBeInstanceOf(DecisionNotFoundError);

    expect(store.decisions.size).toBe(0);
    expect(store.decisionEvents.size).toBe(0);
  });
});
