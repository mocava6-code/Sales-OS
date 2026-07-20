import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DecisionStatus } from "../../intelligence/decision/types";
import { buildKoriDecision } from "../../intelligence/testing/fixtures";
import type { SavedDecisionRecord } from "../../persistence/types";
import { DecisionNotFoundError, MissingOutcomeAttributionError, OutcomeNotAllowedForDecisionStatusError } from "../errors";
import {
  recordConversationAbandoned,
  recordCustomerReply,
  recordFollowUpSent,
  recordQuotationRequested,
  recordQuotationSent,
  recordSaleClosed,
  recordSaleLost,
} from "../outcome-workflows";
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

describe("outcome workflows — 11. correct outcome + event per workflow", () => {
  it("recordSaleClosed appends a SALE_CLOSED outcome and a SALE_CLOSED event", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "EXECUTED");

    const result = await recordSaleClosed(
      { decisionRecordId: seeded.id, notes: "Closed at list price.", attribution: "KORI_RECOMMENDATION" },
      { transactionRunner: runner },
    );

    expect(result.outcome.outcomeType).toBe("SALE_CLOSED");
    expect(result.outcome.notes).toBe("Closed at list price.");
    expect(result.outcome.attribution).toBe("KORI_RECOMMENDATION");
    expect(result.event?.eventType).toBe("SALE_CLOSED");
    expect(store.outcomes.size).toBe(1);
    expect(store.decisionEvents.size).toBe(1);
  });

  it("recordSaleLost appends a SALE_LOST outcome and a SALE_LOST event", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "EXECUTED");

    const result = await recordSaleLost(
      { decisionRecordId: seeded.id, notes: "Went with a competitor.", attribution: "KORI_RECOMMENDATION" },
      { transactionRunner: runner },
    );

    expect(result.outcome.outcomeType).toBe("SALE_LOST");
    expect(result.event?.eventType).toBe("SALE_LOST");
  });

  it("recordCustomerReply and recordFollowUpSent also append their corresponding event", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store);

    const replied = await recordCustomerReply({ decisionRecordId: seeded.id }, { transactionRunner: runner });
    const followUp = await recordFollowUpSent({ decisionRecordId: seeded.id }, { transactionRunner: runner });

    expect(replied.event?.eventType).toBe("CUSTOMER_REPLIED");
    expect(followUp.event?.eventType).toBe("FOLLOW_UP_SENT");
  });

  it("recordQuotationRequested, recordQuotationSent, and recordConversationAbandoned have no corresponding DecisionEvent", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store);

    const requested = await recordQuotationRequested({ decisionRecordId: seeded.id }, { transactionRunner: runner });
    const sent = await recordQuotationSent({ decisionRecordId: seeded.id }, { transactionRunner: runner });
    const abandoned = await recordConversationAbandoned({ decisionRecordId: seeded.id }, { transactionRunner: runner });

    expect(requested.event).toBeUndefined();
    expect(sent.event).toBeUndefined();
    expect(abandoned.event).toBeUndefined();
    expect(store.outcomes.size).toBe(3);
    expect(store.decisionEvents.size).toBe(0);
  });

  it("throws DecisionNotFoundError for an unknown decisionRecordId, before any write", async () => {
    const { runner, store } = createFakeTransactionRunner();

    await expect(
      recordSaleClosed({ decisionRecordId: "does-not-exist" }, { transactionRunner: runner }),
    ).rejects.toBeInstanceOf(DecisionNotFoundError);

    expect(store.outcomes.size).toBe(0);
  });
});

describe("outcome workflows — 10. append-only and chronological", () => {
  it("a decision's thread accumulates a full outcome sequence, never overwriting previous ones", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store);

    await recordCustomerReply(
      { decisionRecordId: seeded.id, occurredAt: new Date("2026-07-18T12:00:00.000Z") },
      { transactionRunner: runner },
    );
    await recordQuotationRequested(
      { decisionRecordId: seeded.id, occurredAt: new Date("2026-07-18T13:00:00.000Z") },
      { transactionRunner: runner },
    );
    await recordQuotationSent(
      { decisionRecordId: seeded.id, occurredAt: new Date("2026-07-18T14:00:00.000Z") },
      { transactionRunner: runner },
    );
    await recordSaleClosed(
      { decisionRecordId: seeded.id, occurredAt: new Date("2026-07-19T09:00:00.000Z"), attribution: "KORI_RECOMMENDATION" },
      { transactionRunner: runner },
    );

    const history = [...store.outcomes.values()].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    expect(history.map((o) => o.outcomeType)).toEqual([
      "CUSTOMER_REPLIED",
      "QUOTATION_REQUESTED",
      "QUOTATION_SENT",
      "SALE_CLOSED",
    ]);
    expect(store.outcomes.size).toBe(4);
  });

  it("never overwrites: two outcomes of the same type both persist as separate rows", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store);

    const first = await recordCustomerReply(
      { decisionRecordId: seeded.id, occurredAt: new Date("2026-07-18T12:00:00.000Z") },
      { transactionRunner: runner },
    );
    const second = await recordCustomerReply(
      { decisionRecordId: seeded.id, occurredAt: new Date("2026-07-18T15:00:00.000Z") },
      { transactionRunner: runner },
    );

    expect(first.outcome.id).not.toBe(second.outcome.id);
    expect(store.outcomes.size).toBe(2);
  });
});

describe("outcome workflows — 3. invalid outcome against a terminal status is rejected", () => {
  it("rejects an unattributed SALE_CLOSED against a REJECTED decision, without writing anything", async () => {
    // Two rules could fire here (missing attribution, and wrong status for
    // an unattributed outcome) — the status check takes priority since it's
    // the more specific/informative failure.
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "REJECTED");

    await expect(
      recordSaleClosed({ decisionRecordId: seeded.id }, { transactionRunner: runner }),
    ).rejects.toBeInstanceOf(OutcomeNotAllowedForDecisionStatusError);

    expect(store.outcomes.size).toBe(0);
  });

  it("rejects a SALE_CLOSED with no attribution against an EXECUTED decision with MissingOutcomeAttributionError", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "EXECUTED");

    await expect(
      recordSaleClosed({ decisionRecordId: seeded.id }, { transactionRunner: runner }),
    ).rejects.toBeInstanceOf(MissingOutcomeAttributionError);

    expect(store.outcomes.size).toBe(0);
  });

  it("rejects a KORI_RECOMMENDATION-attributed outcome against an OVERRIDDEN decision, without writing anything", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "OVERRIDDEN");

    await expect(
      recordQuotationSent({ decisionRecordId: seeded.id, attribution: "KORI_RECOMMENDATION" }, { transactionRunner: runner }),
    ).rejects.toBeInstanceOf(OutcomeNotAllowedForDecisionStatusError);

    expect(store.outcomes.size).toBe(0);
    expect(store.decisionEvents.size).toBe(0);
  });

  it("rejects an unattributed outcome against a CANCELLED decision, without writing anything", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "CANCELLED");

    await expect(
      recordCustomerReply({ decisionRecordId: seeded.id }, { transactionRunner: runner }),
    ).rejects.toBeInstanceOf(OutcomeNotAllowedForDecisionStatusError);

    expect(store.outcomes.size).toBe(0);
  });
});

describe("outcome workflows — 4. advisor-alternative outcome is allowed after override", () => {
  it("records a quotation-sent outcome attributed to ADVISOR_ALTERNATIVE against an OVERRIDDEN decision", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "OVERRIDDEN");

    const result = await recordQuotationSent(
      { decisionRecordId: seeded.id, attribution: "ADVISOR_ALTERNATIVE", notes: "Sent advisor's own quote instead." },
      { transactionRunner: runner },
    );

    expect(result.outcome.outcomeType).toBe("QUOTATION_SENT");
    expect(result.outcome.attribution).toBe("ADVISOR_ALTERNATIVE");
    expect(store.outcomes.size).toBe(1);
  });

  it("records a sale closed via the advisor's own alternative against an OVERRIDDEN decision", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "OVERRIDDEN");

    const result = await recordSaleClosed(
      { decisionRecordId: seeded.id, attribution: "ADVISOR_ALTERNATIVE" },
      { transactionRunner: runner },
    );

    expect(result.outcome.outcomeType).toBe("SALE_CLOSED");
    expect(result.outcome.attribution).toBe("ADVISOR_ALTERNATIVE");
    expect(result.event?.eventType).toBe("SALE_CLOSED");
  });

  it("also allows UNATTRIBUTED (general conversation history) against a REJECTED decision", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "REJECTED");

    const result = await recordConversationAbandoned(
      { decisionRecordId: seeded.id, attribution: "UNATTRIBUTED" },
      { transactionRunner: runner },
    );

    expect(result.outcome.outcomeType).toBe("ABANDONED");
    expect(result.outcome.attribution).toBe("UNATTRIBUTED");
  });
});

describe("outcome workflows — 5. sale outcome attribution persists correctly", () => {
  it("SALE_CLOSED persists KORI_RECOMMENDATION attribution against an EXECUTED decision", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "EXECUTED");

    const result = await recordSaleClosed(
      { decisionRecordId: seeded.id, attribution: "KORI_RECOMMENDATION" },
      { transactionRunner: runner },
    );

    expect(result.outcome.attribution).toBe("KORI_RECOMMENDATION");
    expect(store.outcomes.get(result.outcome.id)?.attribution).toBe("KORI_RECOMMENDATION");
  });

  it("SALE_LOST persists ADVISOR_ALTERNATIVE attribution against an OVERRIDDEN decision", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "OVERRIDDEN");

    const result = await recordSaleLost(
      { decisionRecordId: seeded.id, attribution: "ADVISOR_ALTERNATIVE" },
      { transactionRunner: runner },
    );

    expect(result.outcome.attribution).toBe("ADVISOR_ALTERNATIVE");
    expect(store.outcomes.get(result.outcome.id)?.attribution).toBe("ADVISOR_ALTERNATIVE");
  });

  it("SALE_LOST persists UNATTRIBUTED against a CANCELLED decision", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, "CANCELLED");

    const result = await recordSaleLost(
      { decisionRecordId: seeded.id, attribution: "UNATTRIBUTED" },
      { transactionRunner: runner },
    );

    expect(result.outcome.attribution).toBe("UNATTRIBUTED");
  });
});
