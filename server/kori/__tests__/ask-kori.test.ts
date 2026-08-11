import { describe, expect, it, vi } from "vitest";
import type { GroqClient } from "../groq-client";
import { KoriAIConfigurationError, KoriNaturalLanguageParseError, KoriProviderRateLimitedError, UnsupportedKoriQuestionError } from "../errors";
import type { KoriQueryResult } from "../query-spec";

const { executeKoriQuery } = vi.hoisted(() => ({ executeKoriQuery: vi.fn() }));
vi.mock("../query-executor", () => ({ executeKoriQuery }));

const { askKori } = await import("../ask-kori");

function fakeGroqClient(responseText: string): GroqClient {
  return { model: "test-model", complete: vi.fn().mockResolvedValue(responseText) };
}

describe("askKori — orchestration", () => {
  it("wires businessId, the parsed querySpec, and the formatted result together", async () => {
    executeKoriQuery.mockReset();
    const countResult: KoriQueryResult = { type: "count", count: 7 };
    executeKoriQuery.mockResolvedValue(countResult);

    const groqClient = fakeGroqClient('{"operation":"COUNT_LEADS","filters":{"needsReply":true}}');
    const output = await askKori(
      { businessId: "biz-real-tenant", question: "¿Cuántos clientes necesitan respuesta?" },
      { groqClient },
    );

    expect(executeKoriQuery).toHaveBeenCalledTimes(1);
    const call = executeKoriQuery.mock.calls[0][0];
    expect(call.businessId).toBe("biz-real-tenant");
    expect(call.querySpec.operation).toBe("COUNT_LEADS");

    expect(output.question).toBe("¿Cuántos clientes necesitan respuesta?");
    expect(output.querySpec.operation).toBe("COUNT_LEADS");
    expect(output.result.answer).toBe("Hay 7 clientes que necesitan respuesta.");
    expect(output.result.type).toBe("count");
    expect(output.metadata.timezone).toBe("America/Lima");
    expect(typeof output.metadata.generatedAt).toBe("string");
  });

  it("passes through an explicit timezone override to both parsing and metadata", async () => {
    executeKoriQuery.mockReset();
    executeKoriQuery.mockResolvedValue({ type: "count", count: 1 });
    const groqClient = fakeGroqClient('{"operation":"COUNT_LEADS"}');

    const output = await askKori({ businessId: "biz-1", question: "¿Cuántos clientes tenemos?", timezone: "America/Bogota" }, { groqClient });

    expect(output.metadata.timezone).toBe("America/Bogota");
  });

  it("propagates a preflight rejection (UnsupportedKoriQuestionError) WITHOUT ever calling executeKoriQuery", async () => {
    executeKoriQuery.mockReset();
    const groqClient = fakeGroqClient('{"unsupported": true}'); // would only be used if (incorrectly) called

    await expect(
      askKori({ businessId: "biz-1", question: "DROP TABLE leads" }, { groqClient }),
    ).rejects.toThrow(UnsupportedKoriQuestionError);
    expect(executeKoriQuery).not.toHaveBeenCalled();
    expect(groqClient.complete).not.toHaveBeenCalled();
  });

  it("propagates UnsupportedKoriQuestionError from a Groq-returned unsupported sentinel", async () => {
    executeKoriQuery.mockReset();
    const groqClient = fakeGroqClient('{"unsupported": true}');
    await expect(
      askKori({ businessId: "biz-1", question: "¿Cuántos clientes tenemos activos?" }, { groqClient }),
    ).rejects.toThrow(UnsupportedKoriQuestionError);
    expect(executeKoriQuery).not.toHaveBeenCalled();
  });

  it("propagates KoriProviderRateLimitedError without ever calling executeKoriQuery", async () => {
    executeKoriQuery.mockReset();
    const groqClient: GroqClient = {
      model: "test-model",
      complete: vi.fn().mockRejectedValue(new KoriProviderRateLimitedError("Groq rate limit exceeded (429).")),
    };
    await expect(
      askKori({ businessId: "biz-1", question: "¿Cuántos clientes tenemos activos?" }, { groqClient }),
    ).rejects.toThrow(KoriProviderRateLimitedError);
    expect(executeKoriQuery).not.toHaveBeenCalled();
  });

  it("propagates KoriAIConfigurationError without ever calling executeKoriQuery", async () => {
    executeKoriQuery.mockReset();
    const groqClient: GroqClient = {
      model: "test-model",
      complete: vi.fn().mockRejectedValue(new KoriAIConfigurationError("GROQ_API_KEY is not configured.")),
    };
    await expect(
      askKori({ businessId: "biz-1", question: "¿Cuántos clientes tenemos activos?" }, { groqClient }),
    ).rejects.toThrow(KoriAIConfigurationError);
    expect(executeKoriQuery).not.toHaveBeenCalled();
  });

  it("propagates KoriNaturalLanguageParseError without ever calling executeKoriQuery", async () => {
    executeKoriQuery.mockReset();
    const groqClient = fakeGroqClient("not json at all");
    await expect(
      askKori({ businessId: "biz-1", question: "¿Cuántos clientes tenemos activos?" }, { groqClient }),
    ).rejects.toThrow(KoriNaturalLanguageParseError);
    expect(executeKoriQuery).not.toHaveBeenCalled();
  });

  it("formats a LIST_LEADS result with rows preserved", async () => {
    executeKoriQuery.mockReset();
    const rows = [
      {
        leadId: "lead-1",
        name: "Juan",
        phone: "+51999999999",
        vehicleBrand: "Toyota",
        vehicleModel: null,
        productInterest: null,
        customerType: null,
        needsReply: true,
        nextFollowUpDueAt: null,
        lastActivityAt: null,
      },
    ];
    const listResult: KoriQueryResult = { type: "lead_list", count: 4, rows };
    executeKoriQuery.mockResolvedValue(listResult);
    const groqClient = fakeGroqClient('{"operation":"LIST_LEADS","filters":{"vehicleBrand":"Toyota","needsReply":true}}');

    const output = await askKori({ businessId: "biz-1", question: "¿Clientes Toyota que necesitan respuesta?" }, { groqClient });

    expect(output.result.answer).toBe("Hay 4 clientes Toyota que necesitan respuesta.");
    if (output.result.type === "lead_list") expect(output.result.rows).toEqual(rows);
  });
});
