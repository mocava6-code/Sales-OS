import { describe, expect, it } from "vitest";
import { extractDeterministicCandidates } from "../deterministic-extract";
import type { ExtractionInput, ExtractionMessageInput } from "../../types";

function message(overrides: Partial<ExtractionMessageInput> = {}): ExtractionMessageInput {
  return {
    id: "m0",
    role: "BUSINESS",
    content: "",
    occurredAt: new Date(),
    evidenceRefType: "IMPORTED_MESSAGE",
    evidenceRefId: "msg-1",
    ...overrides,
  };
}

describe("extractDeterministicCandidates — candidates and semanticAnalysisStatus are independent", () => {
  it("Sprint 8 review point 2's own example: two deterministic candidates AND still PENDING for ambiguous content", () => {
    const input: ExtractionInput = {
      kind: "CONVERSATION",
      messages: [
        message({ id: "m0", content: "Sí, el TRAVO sirve para Hilux Revo desde 2016.", evidenceRefId: "msg-1" }),
        message({ id: "m1", content: "Para provincia enviamos por Shalom.", evidenceRefId: "msg-2" }),
        message({
          id: "m2",
          content: "Aparte de eso, si compras el kit completo con instalación incluida te podemos ofrecer condiciones especiales de pago a cuotas",
          evidenceRefId: "msg-3",
        }),
      ],
    };

    const result = extractDeterministicCandidates(input);

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((c) => c.proposedCategory).sort()).toEqual(["COMPATIBILITY", "LOGISTICS"]);
    expect(result.semanticAnalysisStatus).toBe("PENDING");
  });

  it("is NOT_NEEDED when nothing fires and content is trivial", () => {
    const input: ExtractionInput = {
      kind: "CONVERSATION",
      messages: [message({ content: "Hola" }), message({ content: "Gracias", role: "CUSTOMER" })],
    };

    const result = extractDeterministicCandidates(input);

    expect(result.candidates).toHaveLength(0);
    expect(result.semanticAnalysisStatus).toBe("NOT_NEEDED");
  });

  it("can be PENDING with zero deterministic candidates", () => {
    const input: ExtractionInput = {
      kind: "CONVERSATION",
      messages: [message({ content: "Quisiera saber más sobre las opciones de pago disponibles para este pedido", role: "CUSTOMER" })],
    };

    const result = extractDeterministicCandidates(input);

    expect(result.candidates).toHaveLength(0);
    expect(result.semanticAnalysisStatus).toBe("PENDING");
  });
});
