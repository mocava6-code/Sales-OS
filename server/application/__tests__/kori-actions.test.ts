import { describe, expect, it, vi } from "vitest";
import {
  InvalidKoriQuerySpecError,
  KoriAIConfigurationError,
  KoriNaturalLanguageParseError,
  KoriProviderRateLimitedError,
  UnsupportedKoriQuestionError,
} from "../../kori/errors";
import { createFakeAuthContextResolver } from "../testing/fake-auth";

vi.mock("../../kori/ask-kori", () => ({ askKori: vi.fn() }));
const { askKori } = await import("../../kori/ask-kori");
const { askKoriHandler } = await import("../kori-actions");

const advisor = { id: "user-1", businessId: "biz-real-tenant", role: "SALESPERSON" as const };

function fakeAskKoriResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    question: "¿Cuántos clientes necesitan respuesta?",
    querySpec: { operation: "COUNT_LEADS" as const, limit: 25 },
    result: { answer: "Hay 7 clientes que necesitan respuesta.", type: "count" as const, count: 7 },
    metadata: { generatedAt: new Date().toISOString(), timezone: "America/Lima" },
    ...overrides,
  };
}

describe("askKoriHandler — authentication", () => {
  it("returns UNAUTHENTICATED and never calls askKori when there is no signed-in user", async () => {
    vi.mocked(askKori).mockReset();
    const resolver = createFakeAuthContextResolver(null);

    const result = await askKoriHandler({ question: "¿Cuántos clientes necesitan respuesta?" }, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHENTICATED");
    expect(askKori).not.toHaveBeenCalled();
  });
});

describe("askKoriHandler — input validation", () => {
  it("returns INVALID_INPUT for an empty question, never calling askKori", async () => {
    vi.mocked(askKori).mockReset();
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await askKoriHandler({ question: "" }, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
    expect(askKori).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT for a question exceeding the maximum length, never calling askKori", async () => {
    vi.mocked(askKori).mockReset();
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await askKoriHandler({ question: "a".repeat(501) }, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
    expect(askKori).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT when question is missing from raw input entirely", async () => {
    vi.mocked(askKori).mockReset();
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await askKoriHandler({}, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });
});

describe("askKoriHandler — businessId ALWAYS comes from the authenticated context", () => {
  it("passes the authenticated user's businessId to askKori, ignoring any businessId in raw input", async () => {
    vi.mocked(askKori).mockReset();
    vi.mocked(askKori).mockResolvedValue(fakeAskKoriResult());
    const resolver = createFakeAuthContextResolver(advisor);

    await askKoriHandler(
      { question: "¿Cuántos clientes necesitan respuesta?", businessId: "attacker-supplied-biz-id" },
      { resolver },
    );

    expect(askKori).toHaveBeenCalledTimes(1);
    const call = vi.mocked(askKori).mock.calls[0][0];
    expect(call.businessId).toBe("biz-real-tenant");
    expect(call.businessId).not.toBe("attacker-supplied-biz-id");
  });

  it("uses a different authenticated user's businessId correctly (tenant isolation at the handler boundary)", async () => {
    vi.mocked(askKori).mockReset();
    vi.mocked(askKori).mockResolvedValue(fakeAskKoriResult());
    const otherTenantUser = { id: "user-2", businessId: "biz-other-tenant", role: "OWNER" as const };
    const resolver = createFakeAuthContextResolver(otherTenantUser);

    await askKoriHandler({ question: "¿Cuántos clientes necesitan respuesta?" }, { resolver });

    const call = vi.mocked(askKori).mock.calls[0][0];
    expect(call.businessId).toBe("biz-other-tenant");
  });
});

describe("askKoriHandler — successful execution", () => {
  it("returns the askKori result unchanged on success", async () => {
    vi.mocked(askKori).mockReset();
    const expected = fakeAskKoriResult();
    vi.mocked(askKori).mockResolvedValue(expected);
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await askKoriHandler({ question: "¿Cuántos clientes necesitan respuesta?" }, { resolver });

    expect(result).toEqual({ ok: true, data: expected });
  });
});

describe("askKoriHandler — error mapping (no provider/internal detail ever surfaces)", () => {
  const resolver = createFakeAuthContextResolver(advisor);

  it.each([
    [new UnsupportedKoriQuestionError("nope"), "UNSUPPORTED_QUESTION"],
    [new InvalidKoriQuerySpecError("nope"), "UNSUPPORTED_QUESTION"],
    [new KoriProviderRateLimitedError("429"), "RATE_LIMITED"],
    [new KoriAIConfigurationError("missing key"), "PROVIDER_UNAVAILABLE"],
    [new KoriNaturalLanguageParseError("bad json", "leaked internal detail that must never surface"), "PROVIDER_UNAVAILABLE"],
    [new Error("some totally unexpected executor/database failure"), "INTERNAL_ERROR"],
  ] as const)("maps %o to code %s with a safe, pre-crafted message", async (thrown, expectedCode) => {
    vi.mocked(askKori).mockReset();
    vi.mocked(askKori).mockRejectedValue(thrown);

    const result = await askKoriHandler({ question: "¿Cuántos clientes necesitan respuesta?" }, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(expectedCode);
      expect(result.error.message).not.toContain("leaked internal detail");
      expect(result.error.message).not.toBe(thrown.message);
    }
  });
});
