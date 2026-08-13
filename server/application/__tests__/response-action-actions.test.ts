import { describe, expect, it, vi } from "vitest";
import { createFakeAuthContextResolver } from "../testing/fake-auth";

vi.mock("../../services/response-action-ai-batch-service", () => ({ runResponseActionAIBatch: vi.fn() }));
vi.mock("../../services/conversation-action-state-service", () => ({ setHumanConversationActionState: vi.fn() }));
const { runResponseActionAIBatch } = await import("../../services/response-action-ai-batch-service");
const { setHumanConversationActionState } = await import("../../services/conversation-action-state-service");
const { runResponseActionAIBatchHandler, setConversationActionOverrideHandler } = await import("../response-action-actions");

const owner = { id: "user-1", businessId: "biz-real-tenant", role: "OWNER" as const };
const advisor = { id: "user-2", businessId: "biz-real-tenant", role: "SALESPERSON" as const };

function fakeBatchResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    aiProviderConfigured: true,
    aiProviderName: "groq",
    scanned: 3,
    processed: 3,
    skippedRateLimited: 0,
    skippedOtherError: 0,
    distribution: { REPLY_REQUIRED: 2, NO_ACTION_REQUIRED: 1 },
    items: [],
    failures: [],
    ...overrides,
  };
}

describe("runResponseActionAIBatchHandler — authentication", () => {
  it("returns UNAUTHENTICATED and never calls the domain layer when there is no signed-in user", async () => {
    vi.mocked(runResponseActionAIBatch).mockReset();
    const resolver = createFakeAuthContextResolver(null);

    const result = await runResponseActionAIBatchHandler({}, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHENTICATED");
    expect(runResponseActionAIBatch).not.toHaveBeenCalled();
  });
});

describe("runResponseActionAIBatchHandler — authorization (OWNER only)", () => {
  it("returns FORBIDDEN for a SALESPERSON, never calling the domain layer", async () => {
    vi.mocked(runResponseActionAIBatch).mockReset();
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await runResponseActionAIBatchHandler({}, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
    expect(runResponseActionAIBatch).not.toHaveBeenCalled();
  });

  it("allows an OWNER through to the domain layer", async () => {
    vi.mocked(runResponseActionAIBatch).mockReset();
    vi.mocked(runResponseActionAIBatch).mockResolvedValue(fakeBatchResult());
    const resolver = createFakeAuthContextResolver(owner);

    const result = await runResponseActionAIBatchHandler({}, { resolver });

    expect(result.ok).toBe(true);
    expect(runResponseActionAIBatch).toHaveBeenCalledTimes(1);
  });
});

describe("runResponseActionAIBatchHandler — input validation", () => {
  const resolver = createFakeAuthContextResolver(owner);

  it("defaults batchSize=5 and persist=false when omitted", async () => {
    vi.mocked(runResponseActionAIBatch).mockReset();
    vi.mocked(runResponseActionAIBatch).mockResolvedValue(fakeBatchResult());

    await runResponseActionAIBatchHandler({}, { resolver });

    const call = vi.mocked(runResponseActionAIBatch).mock.calls[0][0];
    expect(call.batchSize).toBe(5);
    expect(call.persist).toBe(false);
  });

  it("rejects a batchSize above the maximum, never calling the domain layer", async () => {
    vi.mocked(runResponseActionAIBatch).mockReset();

    const result = await runResponseActionAIBatchHandler({ batchSize: 100 }, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
    expect(runResponseActionAIBatch).not.toHaveBeenCalled();
  });

  it("rejects a batchSize below 1, never calling the domain layer", async () => {
    vi.mocked(runResponseActionAIBatch).mockReset();

    const result = await runResponseActionAIBatchHandler({ batchSize: 0 }, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
    expect(runResponseActionAIBatch).not.toHaveBeenCalled();
  });

  it("passes persist=true through when explicitly requested", async () => {
    vi.mocked(runResponseActionAIBatch).mockReset();
    vi.mocked(runResponseActionAIBatch).mockResolvedValue(fakeBatchResult());

    await runResponseActionAIBatchHandler({ persist: true, batchSize: 10 }, { resolver });

    const call = vi.mocked(runResponseActionAIBatch).mock.calls[0][0];
    expect(call.persist).toBe(true);
    expect(call.batchSize).toBe(10);
  });
});

describe("runResponseActionAIBatchHandler — businessId ALWAYS comes from the authenticated context", () => {
  it("passes the authenticated user's businessId, ignoring any businessId in raw input", async () => {
    vi.mocked(runResponseActionAIBatch).mockReset();
    vi.mocked(runResponseActionAIBatch).mockResolvedValue(fakeBatchResult());
    const resolver = createFakeAuthContextResolver(owner);

    await runResponseActionAIBatchHandler({ businessId: "attacker-supplied-biz-id" }, { resolver });

    const call = vi.mocked(runResponseActionAIBatch).mock.calls[0][0];
    expect(call.businessId).toBe("biz-real-tenant");
    expect(call.businessId).not.toBe("attacker-supplied-biz-id");
  });
});

describe("runResponseActionAIBatchHandler — successful execution", () => {
  it("returns the domain result unchanged on success", async () => {
    vi.mocked(runResponseActionAIBatch).mockReset();
    const expected = fakeBatchResult();
    vi.mocked(runResponseActionAIBatch).mockResolvedValue(expected);
    const resolver = createFakeAuthContextResolver(owner);

    const result = await runResponseActionAIBatchHandler({}, { resolver });

    expect(result).toEqual({ ok: true, data: expected });
  });
});

describe("runResponseActionAIBatchHandler — error mapping (no provider/internal detail ever surfaces)", () => {
  it("maps an unexpected failure to INTERNAL_ERROR with a safe message", async () => {
    vi.mocked(runResponseActionAIBatch).mockReset();
    vi.mocked(runResponseActionAIBatch).mockRejectedValue(new Error("leaked internal detail that must never surface"));
    const resolver = createFakeAuthContextResolver(owner);

    const result = await runResponseActionAIBatchHandler({}, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
      expect(result.error.message).not.toContain("leaked internal detail");
    }
  });
});

describe("setConversationActionOverrideHandler — authentication", () => {
  it("returns UNAUTHENTICATED and never calls the domain layer when there is no signed-in user", async () => {
    vi.mocked(setHumanConversationActionState).mockReset();
    const resolver = createFakeAuthContextResolver(null);

    const result = await setConversationActionOverrideHandler({ conversationId: "conv-1", label: "REQUIERE_RESPUESTA" }, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHENTICATED");
    expect(setHumanConversationActionState).not.toHaveBeenCalled();
  });
});

describe("setConversationActionOverrideHandler — no OWNER gate, any authenticated advisor may mark a conversation", () => {
  it("allows a SALESPERSON through to the domain layer", async () => {
    vi.mocked(setHumanConversationActionState).mockReset();
    vi.mocked(setHumanConversationActionState).mockResolvedValue(undefined);
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await setConversationActionOverrideHandler({ conversationId: "conv-1", label: "NO_REQUIERE_ACCION" }, { resolver });

    expect(result.ok).toBe(true);
    expect(setHumanConversationActionState).toHaveBeenCalledTimes(1);
  });
});

describe("setConversationActionOverrideHandler — label -> (actionState, reasonCode) mapping", () => {
  const resolver = createFakeAuthContextResolver(owner);

  it.each([
    ["REQUIERE_RESPUESTA", "REPLY_REQUIRED", "MARKED_REPLY_REQUIRED"],
    ["NECESITA_SEGUIMIENTO", "FOLLOW_UP_REQUIRED", "MARKED_FOLLOW_UP_REQUIRED"],
    ["ESPERANDO_CLIENTE", "WAITING_ON_CUSTOMER", "MARKED_ALREADY_ANSWERED"],
    ["NO_REQUIERE_ACCION", "NO_ACTION_REQUIRED", "MARKED_NO_ACTION_REQUIRED"],
  ] as const)('label "%s" maps to actionState "%s" and reasonCode "%s"', async (label, expectedActionState, expectedReasonCode) => {
    vi.mocked(setHumanConversationActionState).mockReset();
    vi.mocked(setHumanConversationActionState).mockResolvedValue(undefined);

    const result = await setConversationActionOverrideHandler({ conversationId: "conv-1", label }, { resolver });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.actionState).toBe(expectedActionState);
    expect(setHumanConversationActionState).toHaveBeenCalledWith(owner.businessId, "conv-1", expectedActionState, expectedReasonCode, owner.id);
  });
});

describe("setConversationActionOverrideHandler — businessId ALWAYS comes from the authenticated context", () => {
  it("passes the authenticated user's businessId, ignoring any businessId in raw input", async () => {
    vi.mocked(setHumanConversationActionState).mockReset();
    vi.mocked(setHumanConversationActionState).mockResolvedValue(undefined);
    const resolver = createFakeAuthContextResolver(owner);

    await setConversationActionOverrideHandler({ conversationId: "conv-1", label: "REQUIERE_RESPUESTA", businessId: "attacker-supplied-biz-id" }, { resolver });

    const call = vi.mocked(setHumanConversationActionState).mock.calls[0];
    expect(call[0]).toBe("biz-real-tenant");
    expect(call[0]).not.toBe("attacker-supplied-biz-id");
  });
});

describe("setConversationActionOverrideHandler — input validation", () => {
  const resolver = createFakeAuthContextResolver(owner);

  it("rejects a missing conversationId, never calling the domain layer", async () => {
    vi.mocked(setHumanConversationActionState).mockReset();

    const result = await setConversationActionOverrideHandler({ label: "REQUIERE_RESPUESTA" }, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
    expect(setHumanConversationActionState).not.toHaveBeenCalled();
  });

  it("rejects a label outside the closed set, never calling the domain layer", async () => {
    vi.mocked(setHumanConversationActionState).mockReset();

    const result = await setConversationActionOverrideHandler({ conversationId: "conv-1", label: "NOT_A_REAL_LABEL" }, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
    expect(setHumanConversationActionState).not.toHaveBeenCalled();
  });
});

describe("setConversationActionOverrideHandler — error mapping", () => {
  const resolver = createFakeAuthContextResolver(owner);

  it('maps the domain layer\'s "Conversation not found." error to NOT_FOUND, never leaking the raw message', async () => {
    vi.mocked(setHumanConversationActionState).mockReset();
    vi.mocked(setHumanConversationActionState).mockRejectedValue(new Error("Conversation not found."));

    const result = await setConversationActionOverrideHandler({ conversationId: "conv-does-not-exist", label: "REQUIERE_RESPUESTA" }, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("maps an unrelated unexpected failure to INTERNAL_ERROR with a safe message", async () => {
    vi.mocked(setHumanConversationActionState).mockReset();
    vi.mocked(setHumanConversationActionState).mockRejectedValue(new Error("leaked internal detail that must never surface"));

    const result = await setConversationActionOverrideHandler({ conversationId: "conv-1", label: "REQUIERE_RESPUESTA" }, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
      expect(result.error.message).not.toContain("leaked internal detail");
    }
  });
});
