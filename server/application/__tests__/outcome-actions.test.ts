import { describe, expect, it, vi } from "vitest";
import { buildKoriDecision } from "../../intelligence/testing/fixtures";
import type { SavedDecisionRecord } from "../../persistence/types";
import { NotFoundError } from "../errors";
import { createFakeAuthContextResolver } from "../testing/fake-auth";

vi.mock("../access-control", () => ({ loadAuthorizedConversation: vi.fn(), loadAuthorizedDecisionRecord: vi.fn() }));
vi.mock("../../services/outcome-service", () => ({ recordConversationOutcome: vi.fn() }));

const { loadAuthorizedConversation, loadAuthorizedDecisionRecord } = await import("../access-control");
const { recordConversationOutcome } = await import("../../services/outcome-service");
const { recordConversationOutcomeHandler } = await import("../outcome-actions");

const advisor = { id: "user-1", businessId: "biz-real-tenant", role: "SALESPERSON" as const };

function fakeConversation(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "conv-1", businessId: "biz-real-tenant", channel: "WHATSAPP" as const, entries: [], ...overrides };
}

function fakeOutcome(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "outcome-1",
    conversationId: "conv-1",
    decisionRecordId: null,
    outcomeType: "SALE_CLOSED",
    attribution: "UNATTRIBUTED",
    lostReason: null,
    productSold: null,
    notes: null,
    occurredAt: new Date("2026-08-13T10:00:00.000Z"),
    ...overrides,
  };
}

function fakeDecision(overrides: Partial<SavedDecisionRecord> = {}): SavedDecisionRecord {
  return {
    id: "decision-1",
    businessId: "biz-real-tenant",
    conversationId: "conv-1",
    conversationSnapshotId: null,
    decision: buildKoriDecision(),
    createdAt: new Date("2026-08-13T09:00:00.000Z"),
    ...overrides,
  };
}

describe("recordConversationOutcomeHandler — authentication", () => {
  it("returns UNAUTHENTICATED and never loads the conversation when there is no signed-in user", async () => {
    vi.mocked(loadAuthorizedConversation).mockReset();
    const resolver = createFakeAuthContextResolver(null);

    const result = await recordConversationOutcomeHandler({ conversationId: "conv-1", outcomeType: "SALE_CLOSED" }, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHENTICATED");
    expect(loadAuthorizedConversation).not.toHaveBeenCalled();
  });
});

describe("recordConversationOutcomeHandler — input validation", () => {
  it("returns INVALID_INPUT for SALE_LOST with no lostReason, never touching the conversation or the service", async () => {
    vi.mocked(loadAuthorizedConversation).mockReset();
    vi.mocked(recordConversationOutcome).mockReset();
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await recordConversationOutcomeHandler({ conversationId: "conv-1", outcomeType: "SALE_LOST" }, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
    expect(loadAuthorizedConversation).not.toHaveBeenCalled();
    expect(recordConversationOutcome).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT for an unknown outcomeType", async () => {
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await recordConversationOutcomeHandler({ conversationId: "conv-1", outcomeType: "MAYBE" }, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });
});

describe("recordConversationOutcomeHandler — tenant isolation", () => {
  it("returns NOT_FOUND, never INTERNAL details, for a cross-tenant conversation", async () => {
    vi.mocked(loadAuthorizedConversation).mockReset();
    vi.mocked(loadAuthorizedConversation).mockRejectedValue(new NotFoundError("la conversación"));
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await recordConversationOutcomeHandler({ conversationId: "conv-owned-by-another-business", outcomeType: "SALE_CLOSED" }, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
      expect(result.error.message).not.toMatch(/prisma|stack|at\s+\//i);
    }
  });
});

describe("recordConversationOutcomeHandler — successful execution", () => {
  it("passes the authenticated user's businessId and the resolved conversation's id to the service, ignoring any businessId in raw input", async () => {
    vi.mocked(loadAuthorizedConversation).mockReset();
    vi.mocked(recordConversationOutcome).mockReset();
    vi.mocked(loadAuthorizedConversation).mockResolvedValue(fakeConversation());
    vi.mocked(recordConversationOutcome).mockResolvedValue(fakeOutcome());
    const resolver = createFakeAuthContextResolver(advisor);

    await recordConversationOutcomeHandler(
      { conversationId: "conv-1", outcomeType: "SALE_CLOSED", businessId: "attacker-supplied-biz-id" },
      { resolver },
    );

    expect(recordConversationOutcome).toHaveBeenCalledTimes(1);
    const call = vi.mocked(recordConversationOutcome).mock.calls[0];
    expect(call[0]).toBe("biz-real-tenant");
    expect(call[1]).toBe("conv-1");
    expect(call[2]).toBe("user-1");
  });

  it("returns a ConversationOutcomeDTO built from the service result on success", async () => {
    vi.mocked(loadAuthorizedConversation).mockReset();
    vi.mocked(recordConversationOutcome).mockReset();
    vi.mocked(loadAuthorizedConversation).mockResolvedValue(fakeConversation());
    vi.mocked(recordConversationOutcome).mockResolvedValue(fakeOutcome({ outcomeType: "SALE_LOST", lostReason: "PRECIO" }));
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await recordConversationOutcomeHandler(
      { conversationId: "conv-1", outcomeType: "SALE_LOST", lostReason: "PRECIO" },
      { resolver },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.outcomeType).toBe("SALE_LOST");
      expect(result.data.lostReason).toBe("PRECIO");
      expect(result.data.id).toBe("outcome-1");
    }
  });

  it("forwards lostReason/productSold/notes through to the service", async () => {
    vi.mocked(loadAuthorizedConversation).mockReset();
    vi.mocked(recordConversationOutcome).mockReset();
    vi.mocked(loadAuthorizedConversation).mockResolvedValue(fakeConversation());
    vi.mocked(recordConversationOutcome).mockResolvedValue(fakeOutcome());
    const resolver = createFakeAuthContextResolver(advisor);

    await recordConversationOutcomeHandler(
      { conversationId: "conv-1", outcomeType: "SALE_CLOSED", productSold: "Kit TRAVO", notes: "Pagó al contado." },
      { resolver },
    );

    const call = vi.mocked(recordConversationOutcome).mock.calls[0];
    expect(call[3]).toEqual({
      outcomeType: "SALE_CLOSED",
      lostReason: undefined,
      productSold: "Kit TRAVO",
      notes: "Pagó al contado.",
      decisionRecordId: undefined,
      attribution: undefined,
    });
  });
});

describe("recordConversationOutcomeHandler — decision attribution linking", () => {
  it("requires attribution when a decisionRecordId is given", async () => {
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await recordConversationOutcomeHandler(
      { conversationId: "conv-1", outcomeType: "SALE_CLOSED", decisionRecordId: "decision-1" },
      { resolver },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("rejects a decisionRecordId that belongs to a different conversation", async () => {
    vi.mocked(loadAuthorizedConversation).mockReset();
    vi.mocked(loadAuthorizedDecisionRecord).mockReset();
    vi.mocked(loadAuthorizedConversation).mockResolvedValue(fakeConversation());
    vi.mocked(loadAuthorizedDecisionRecord).mockResolvedValue(fakeDecision({ conversationId: "conv-other" }));
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await recordConversationOutcomeHandler(
      { conversationId: "conv-1", outcomeType: "SALE_CLOSED", decisionRecordId: "decision-1", attribution: "KORI_RECOMMENDATION" },
      { resolver },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("passes decisionRecordId and attribution through to the service once the decision is verified", async () => {
    vi.mocked(loadAuthorizedConversation).mockReset();
    vi.mocked(loadAuthorizedDecisionRecord).mockReset();
    vi.mocked(recordConversationOutcome).mockReset();
    vi.mocked(loadAuthorizedConversation).mockResolvedValue(fakeConversation());
    vi.mocked(loadAuthorizedDecisionRecord).mockResolvedValue(fakeDecision());
    vi.mocked(recordConversationOutcome).mockResolvedValue(fakeOutcome({ decisionRecordId: "decision-1", attribution: "KORI_RECOMMENDATION" }));
    const resolver = createFakeAuthContextResolver(advisor);

    await recordConversationOutcomeHandler(
      { conversationId: "conv-1", outcomeType: "SALE_CLOSED", decisionRecordId: "decision-1", attribution: "KORI_RECOMMENDATION" },
      { resolver },
    );

    const call = vi.mocked(recordConversationOutcome).mock.calls[0];
    expect(call[3]).toEqual({
      outcomeType: "SALE_CLOSED",
      lostReason: undefined,
      productSold: undefined,
      notes: undefined,
      decisionRecordId: "decision-1",
      attribution: "KORI_RECOMMENDATION",
    });
  });
});

describe("recordConversationOutcomeHandler — error mapping (no internal detail ever surfaces)", () => {
  it("maps an unexpected service failure to INTERNAL_ERROR without leaking the raw error", async () => {
    vi.mocked(loadAuthorizedConversation).mockReset();
    vi.mocked(recordConversationOutcome).mockReset();
    vi.mocked(loadAuthorizedConversation).mockResolvedValue(fakeConversation());
    vi.mocked(recordConversationOutcome).mockRejectedValue(new Error("connection reset by peer: db.internal.example:5432"));
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await recordConversationOutcomeHandler({ conversationId: "conv-1", outcomeType: "SALE_CLOSED" }, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
      expect(result.error.message).not.toMatch(/db\.internal|5432|connection reset/i);
    }
  });
});
