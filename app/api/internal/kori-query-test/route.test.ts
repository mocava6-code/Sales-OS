import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const { askKoriHandler } = vi.hoisted(() => ({ askKoriHandler: vi.fn() }));

vi.mock("@/server/application/kori-actions", () => ({ askKoriHandler }));

const { GET } = await import("./route");

function requestFor(query: string) {
  return new NextRequest(`https://sales-os-wheat.vercel.app/api/internal/kori-query-test${query}`);
}

describe("GET /api/internal/kori-query-test", () => {
  it("passes only { question } to askKoriHandler — never a businessId, even if the query string has one", async () => {
    askKoriHandler.mockReset();
    askKoriHandler.mockResolvedValue({
      ok: true,
      data: { question: "¿Cuántos clientes necesitan respuesta?", querySpec: {}, result: { answer: "Hay 7 clientes.", type: "count", count: 7 }, metadata: {} },
    });

    const response = await GET(requestFor("?q=%C2%BFCu%C3%A1ntos%20clientes%20necesitan%20respuesta%3F&businessId=attacker-supplied"));

    expect(askKoriHandler).toHaveBeenCalledTimes(1);
    const rawInput = askKoriHandler.mock.calls[0][0];
    expect(rawInput).toEqual({ question: "¿Cuántos clientes necesitan respuesta?" });
    expect(rawInput.businessId).toBeUndefined();
    expect(response.status).toBe(200);
  });

  it("returns the askKoriHandler success payload as-is", async () => {
    askKoriHandler.mockReset();
    const data = { question: "q", querySpec: { operation: "COUNT_LEADS" }, result: { answer: "Hay 7 clientes.", type: "count", count: 7 }, metadata: { timezone: "America/Lima" } };
    askKoriHandler.mockResolvedValue({ ok: true, data });

    const response = await GET(requestFor("?q=test"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(data);
  });

  it.each([
    ["UNAUTHENTICATED", 401],
    ["INVALID_INPUT", 400],
    ["UNSUPPORTED_QUESTION", 400],
    ["RATE_LIMITED", 429],
    ["PROVIDER_UNAVAILABLE", 503],
    ["INTERNAL_ERROR", 500],
  ] as const)("maps ApplicationErrorCode %s to HTTP %d", async (code, expectedStatus) => {
    askKoriHandler.mockReset();
    askKoriHandler.mockResolvedValue({ ok: false, error: { code, message: "safe message" } });

    const response = await GET(requestFor("?q=test"));
    const body = await response.json();

    expect(response.status).toBe(expectedStatus);
    expect(body).toEqual({ error: { code, message: "safe message" } });
  });

  it("never includes provider/internal detail in an error response — only what askKoriHandler's safe mapping already produced", async () => {
    askKoriHandler.mockReset();
    askKoriHandler.mockResolvedValue({ ok: false, error: { code: "PROVIDER_UNAVAILABLE", message: "Kori's AI provider is unavailable right now. Try again shortly." } });

    const response = await GET(requestFor("?q=test"));
    const bodyText = await response.text();

    expect(bodyText).not.toMatch(/groq/i);
    expect(bodyText).not.toMatch(/prisma/i);
    expect(bodyText).not.toMatch(/api[_-]?key/i);
  });
});
