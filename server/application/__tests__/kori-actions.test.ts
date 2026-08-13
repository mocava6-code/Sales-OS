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
vi.mock("../../kori/strategic-intent-classifier", () => ({ classifyStrategicIntent: vi.fn() }));
vi.mock("../../services/kori-strategic-answer-service", () => ({ answerStrategicQuestion: vi.fn() }));

const { askKori } = await import("../../kori/ask-kori");
const { classifyStrategicIntent } = await import("../../kori/strategic-intent-classifier");
const { answerStrategicQuestion } = await import("../../services/kori-strategic-answer-service");
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

/** Every test in this file that exercises the operational path must pin classifyStrategicIntent to null — otherwise it's unmocked-default (undefined), which is falsy too, but explicit beats implicit. */
function stubNoStrategicIntent() {
  vi.mocked(classifyStrategicIntent).mockReset();
  vi.mocked(classifyStrategicIntent).mockResolvedValue(null);
}

describe("askKoriHandler — authentication", () => {
  it("returns UNAUTHENTICATED and never calls askKori or classifyStrategicIntent when there is no signed-in user", async () => {
    vi.mocked(askKori).mockReset();
    vi.mocked(classifyStrategicIntent).mockReset();
    const resolver = createFakeAuthContextResolver(null);

    const result = await askKoriHandler({ question: "¿Cuántos clientes necesitan respuesta?" }, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHENTICATED");
    expect(askKori).not.toHaveBeenCalled();
    expect(classifyStrategicIntent).not.toHaveBeenCalled();
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
    stubNoStrategicIntent();
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
    stubNoStrategicIntent();
    vi.mocked(askKori).mockReset();
    vi.mocked(askKori).mockResolvedValue(fakeAskKoriResult());
    const otherTenantUser = { id: "user-2", businessId: "biz-other-tenant", role: "OWNER" as const };
    const resolver = createFakeAuthContextResolver(otherTenantUser);

    await askKoriHandler({ question: "¿Cuántos clientes necesitan respuesta?" }, { resolver });

    const call = vi.mocked(askKori).mock.calls[0][0];
    expect(call.businessId).toBe("biz-other-tenant");
  });
});

describe("askKoriHandler — successful execution (operational path)", () => {
  it("returns the askKori result wrapped with kind: 'operational' on success", async () => {
    stubNoStrategicIntent();
    vi.mocked(askKori).mockReset();
    const expected = fakeAskKoriResult();
    vi.mocked(askKori).mockResolvedValue(expected);
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await askKoriHandler({ question: "¿Cuántos clientes necesitan respuesta?" }, { resolver });

    expect(result).toEqual({ ok: true, data: { kind: "operational", ...expected } });
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
    stubNoStrategicIntent();
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

describe("askKoriHandler — strategic questions (Kori Commercial Intelligence V2)", () => {
  const resolver = createFakeAuthContextResolver(advisor);

  it("routes to answerStrategicQuestion and never calls askKori when a strategic intent is classified", async () => {
    vi.mocked(classifyStrategicIntent).mockReset();
    vi.mocked(askKori).mockReset();
    vi.mocked(answerStrategicQuestion).mockReset();
    vi.mocked(classifyStrategicIntent).mockResolvedValue("TOP_OPPORTUNITY_PRODUCT");
    vi.mocked(answerStrategicQuestion).mockResolvedValue("Hilux TRAVO tiene mayor potencial.");

    const result = await askKoriHandler({ question: "¿Qué debería vender más este mes?" }, { resolver });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ kind: "strategic", intent: "TOP_OPPORTUNITY_PRODUCT", result: { answer: "Hilux TRAVO tiene mayor potencial." } });
    }
    expect(askKori).not.toHaveBeenCalled();
  });

  it("passes the authenticated user's businessId to answerStrategicQuestion, never a businessId from raw input", async () => {
    vi.mocked(classifyStrategicIntent).mockReset();
    vi.mocked(answerStrategicQuestion).mockReset();
    vi.mocked(classifyStrategicIntent).mockResolvedValue("MAIN_WEAKNESS");
    vi.mocked(answerStrategicQuestion).mockResolvedValue("El principal punto débil es el seguimiento.");

    await askKoriHandler({ question: "¿Qué estamos haciendo mal?", businessId: "attacker-supplied-biz-id" }, { resolver });

    const call = vi.mocked(answerStrategicQuestion).mock.calls[0];
    expect(call[0]).toBe("biz-real-tenant");
    expect(call[1]).toBe("MAIN_WEAKNESS");
  });

  it("falls through to askKori exactly as before when classifyStrategicIntent returns null", async () => {
    stubNoStrategicIntent();
    vi.mocked(askKori).mockReset();
    vi.mocked(answerStrategicQuestion).mockReset();
    vi.mocked(askKori).mockResolvedValue(fakeAskKoriResult());

    const result = await askKoriHandler({ question: "¿Cuántos clientes necesitan respuesta?" }, { resolver });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.kind).toBe("operational");
    expect(answerStrategicQuestion).not.toHaveBeenCalled();
  });

  it("maps an unexpected answerStrategicQuestion failure to INTERNAL_ERROR without leaking the raw error", async () => {
    vi.mocked(classifyStrategicIntent).mockReset();
    vi.mocked(answerStrategicQuestion).mockReset();
    vi.mocked(classifyStrategicIntent).mockResolvedValue("WHERE_TO_INVEST");
    vi.mocked(answerStrategicQuestion).mockRejectedValue(new Error("connection reset by peer: db.internal.example:5432"));

    const result = await askKoriHandler({ question: "¿Dónde debería invertir publicidad?" }, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
      expect(result.error.message).not.toMatch(/db\.internal|5432|connection reset/i);
    }
  });
});
