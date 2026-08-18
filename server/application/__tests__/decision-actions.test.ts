import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMockAIProvider } from "../../intelligence/testing/mock-ai-provider";
import { buildKoriDecision } from "../../intelligence/testing/fixtures";
import { createFakeTransactionRunner, type FakeStore } from "../../orchestration/__tests__/fakes";
import { decisionProposal, minimalProviderResult } from "../../orchestration/__tests__/provider-fixtures";
import type { SavedDecisionRecord } from "../../persistence/types";
import type { AuthorizedConversation } from "../access-control";
import {
  analyzeConversationHandler,
  approveDecisionHandler,
  rejectDecisionHandler,
} from "../decision-actions";
import { NotFoundError } from "../errors";
import { createFakeAuthContextResolver } from "../testing/fake-auth";

function seedDecision(
  store: FakeStore,
  overrides: Partial<{ businessId: string; approvalRequirement: SavedDecisionRecord["decision"]["approvalRequirement"] }> = {},
): SavedDecisionRecord {
  const decision = buildKoriDecision({
    status: "PROPOSED",
    approvalRequirement: overrides.approvalRequirement ?? "ADVISOR_APPROVAL_REQUIRED",
  });
  const saved: SavedDecisionRecord = {
    id: randomUUID(),
    businessId: overrides.businessId ?? "biz-1",
    conversationId: decision.metadata.conversationId,
    conversationSnapshotId: null,
    decision,
    createdAt: new Date(),
  };
  store.decisions.set(saved.id, saved);
  return saved;
}

const advisor = { id: "user-advisor", businessId: "biz-1", role: "SALESPERSON" as const };
const admin = { id: "user-admin", businessId: "biz-1", role: "OWNER" as const };

describe("decision actions — 6. unauthenticated actions fail safely", () => {
  it("approveDecisionHandler returns UNAUTHENTICATED and never opens a transaction", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const resolver = createFakeAuthContextResolver(null);

    const result = await approveDecisionHandler(
      { decisionRecordId: "irrelevant" },
      { resolver, transactionRunner: runner },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHENTICATED");
    expect(store.decisions.size).toBe(0);
  });

  it("analyzeConversationHandler returns UNAUTHENTICATED without loading the conversation", async () => {
    const { runner } = createFakeTransactionRunner();
    const resolver = createFakeAuthContextResolver(null);
    let loadConversationCalled = false;

    const result = await analyzeConversationHandler(
      { conversationId: "conv-1" },
      {
        resolver,
        transactionRunner: runner,
        loadConversation: async () => {
          loadConversationCalled = true;
          throw new Error("should never be called");
        },
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHENTICATED");
    expect(loadConversationCalled).toBe(false);
  });
});

describe("decision actions — 7. a user from another business cannot access the conversation", () => {
  it("analyzeConversationHandler returns NOT_FOUND, never INTERNAL details, for a cross-tenant conversation", async () => {
    const { runner } = createFakeTransactionRunner();
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await analyzeConversationHandler(
      { conversationId: "conv-owned-by-another-business" },
      {
        resolver,
        transactionRunner: runner,
        loadConversation: async () => {
          throw new NotFoundError("Conversation");
        },
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
      expect(result.error.message).not.toMatch(/prisma|stack|at\s+\//i);
    }
  });

  it("approveDecisionHandler returns NOT_FOUND for a decision belonging to another business", async () => {
    const { runner } = createFakeTransactionRunner();
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await approveDecisionHandler(
      { decisionRecordId: "decision-owned-by-another-business" },
      {
        resolver,
        transactionRunner: runner,
        loadDecisionRecord: async () => {
          throw new NotFoundError("Decision");
        },
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });
});

describe("decision actions — 8. an advisor cannot perform admin-only approval", () => {
  it("returns FORBIDDEN when a SALESPERSON approves an ADMIN_APPROVAL_REQUIRED decision", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, { approvalRequirement: "ADMIN_APPROVAL_REQUIRED" });
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await approveDecisionHandler(
      { decisionRecordId: seeded.id },
      { resolver, transactionRunner: runner, loadDecisionRecord: async () => seeded },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
    expect(store.decisions.get(seeded.id)?.decision.status).toBe("PROPOSED");
  });

  it("allows an OWNER to approve the same ADMIN_APPROVAL_REQUIRED decision", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, { approvalRequirement: "ADMIN_APPROVAL_REQUIRED" });
    const resolver = createFakeAuthContextResolver(admin);

    const result = await approveDecisionHandler(
      { decisionRecordId: seeded.id },
      { resolver, transactionRunner: runner, loadDecisionRecord: async () => seeded },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.status).toBe("APPROVED");
  });

  it("allows a SALESPERSON to approve an ADVISOR_APPROVAL_REQUIRED decision", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store, { approvalRequirement: "ADVISOR_APPROVAL_REQUIRED" });
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await approveDecisionHandler(
      { decisionRecordId: seeded.id },
      { resolver, transactionRunner: runner, loadDecisionRecord: async () => seeded },
    );

    expect(result.ok).toBe(true);
  });
});

describe("decision actions — 9. server actions map orchestration errors safely", () => {
  it("maps InvalidDecisionStatusTransitionError to INVALID_TRANSITION with no leaked internals", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const seeded = seedDecision(store);
    // Force the decision into a terminal status directly in the store so the
    // orchestration workflow itself (not the access-control layer) is what
    // rejects the transition.
    const terminal = { ...seeded, decision: { ...seeded.decision, status: "EXECUTED" as const } };
    store.decisions.set(seeded.id, terminal);
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await rejectDecisionHandler(
      { decisionRecordId: seeded.id, note: "trying to reject an already-executed decision" },
      { resolver, transactionRunner: runner, loadDecisionRecord: async () => terminal },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_TRANSITION");
      expect(result.error.message).not.toMatch(/prisma|stack|at\s+\/|node_modules/i);
    }
  });

  it("maps an unexpected transaction failure to ORCHESTRATION_FAILURE without leaking the raw error", async () => {
    const { runner, store } = createFakeTransactionRunner({
      decisions: (base) => ({
        ...base,
        updateStatus: async () => {
          throw new Error("connection reset by peer: db.internal.example:5432");
        },
      }),
    });
    const seeded = seedDecision(store);
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await approveDecisionHandler(
      { decisionRecordId: seeded.id },
      { resolver, transactionRunner: runner, loadDecisionRecord: async () => seeded },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ORCHESTRATION_FAILURE");
      expect(result.error.message).not.toMatch(/db\.internal|5432|connection reset/i);
    }
  });

  it("maps invalid input to INVALID_INPUT with field errors, before touching the store", async () => {
    const { runner, store } = createFakeTransactionRunner();
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await rejectDecisionHandler(
      { decisionRecordId: "abc", note: "" }, // empty note — rejection requires one
      { resolver, transactionRunner: runner },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_INPUT");
      expect(result.error.fieldErrors).toBeTruthy();
    }
    expect(store.decisions.size).toBe(0);
  });
});

describe("decision actions — 11. analyze action returns persisted decisions", () => {
  it("returns the persisted snapshot id and every decision produced by orchestration", async () => {
    const { runner } = createFakeTransactionRunner();
    const resolver = createFakeAuthContextResolver(advisor);
    const mock = createMockAIProvider({
      response: () => JSON.stringify(minimalProviderResult()),
      decisionReasoningResponse: () =>
        JSON.stringify({ decisions: [decisionProposal("Decision A"), decisionProposal("Decision B")] }),
    });

    const fakeConversation: AuthorizedConversation = {
      id: "conv-1",
      businessId: "biz-1",
      channel: "WHATSAPP",
      entries: [{ direction: "INBOUND", content: "Hola", occurredAt: new Date("2026-07-18T12:00:00.000Z") }],
    };

    const result = await analyzeConversationHandler(
      { conversationId: "conv-1" },
      {
        resolver,
        transactionRunner: runner,
        aiProvider: mock.provider,
        knowledgeSource: { search: async () => [] },
        loadConversation: async () => fakeConversation,
        runWithAnalysisLock: async (_businessId, _conversationId, work) => work(),
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.conversationSnapshotId).toBeTruthy();
      expect(result.data.decisions).toHaveLength(2);
      expect(result.data.decisions.every((d) => d.status === "PROPOSED")).toBe(true);
    }
  });
});
