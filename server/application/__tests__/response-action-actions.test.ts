import { describe, expect, it, vi } from "vitest";
import { createFakeAuthContextResolver } from "../testing/fake-auth";

vi.mock("../../services/response-action-ai-batch-service", () => ({ runResponseActionAIBatch: vi.fn() }));
const { runResponseActionAIBatch } = await import("../../services/response-action-ai-batch-service");
const { runResponseActionAIBatchHandler } = await import("../response-action-actions");

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
