import { describe, expect, it } from "vitest";
import { validateAndResolveCandidates } from "../extraction-grounding";
import type { KnowledgeExtractionProviderCandidate } from "../extraction-schema";
import type { ExtractionInput } from "../types";

function conversationInput(content: string): ExtractionInput {
  return {
    kind: "CONVERSATION",
    messages: [
      { id: "m0", role: "BUSINESS", content, occurredAt: new Date(), evidenceRefType: "IMPORTED_MESSAGE", evidenceRefId: "msg-1" },
    ],
  };
}

function documentInput(text: string, context: "PRODUCT" | "MARKETING" | "TESTIMONIAL" | "POLICY"): ExtractionInput {
  return {
    kind: "DOCUMENT",
    document: {
      id: "page-1",
      url: "https://koriakiimport.com/tienda",
      title: "Tienda",
      sections: [{ id: "s0", context, heading: null, text, reliable: true }],
      evidenceRefType: "WEBSITE_PAGE",
      evidenceRefId: "page-1",
    },
  };
}

function candidate(overrides: Partial<KnowledgeExtractionProviderCandidate> = {}): KnowledgeExtractionProviderCandidate {
  return {
    class: "FACTUAL",
    proposedCategory: "COMPATIBILITY",
    subject: "Hilux TRAVO",
    statement: "Compatible con Hilux Revo desde 2016.",
    evidenceRefIndex: 0,
    evidenceQuote: "el TRAVO sirve para Hilux Revo desde 2016",
    confidence: 0.9,
    ...overrides,
  };
}

describe("validateAndResolveCandidates — grounding", () => {
  it("accepts a candidate whose evidenceQuote is a verbatim substring", () => {
    const input = conversationInput("Sí, el TRAVO sirve para Hilux Revo desde 2016.");
    const result = validateAndResolveCandidates([candidate()], input);

    expect(result.candidates).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
    expect(result.candidates[0]).toMatchObject({
      evidenceRefType: "IMPORTED_MESSAGE",
      evidenceRefId: "msg-1",
      evidenceText: "el TRAVO sirve para Hilux Revo desde 2016",
    });
  });

  it("is case-insensitive when checking the verbatim substring", () => {
    const input = conversationInput("SÍ, EL TRAVO SIRVE PARA HILUX REVO DESDE 2016.");
    const result = validateAndResolveCandidates([candidate()], input);
    expect(result.candidates).toHaveLength(1);
  });

  it("drops a candidate whose evidenceQuote is not a real substring (fabricated evidence)", () => {
    const input = conversationInput("Hola, buenas tardes.");
    const result = validateAndResolveCandidates([candidate()], input);

    expect(result.candidates).toHaveLength(0);
    expect(result.dropped[0].reason).toMatch(/verbatim/);
  });

  it("drops a candidate whose evidenceRefIndex is out of range", () => {
    const input = conversationInput("Sí, el TRAVO sirve.");
    const result = validateAndResolveCandidates([candidate({ evidenceRefIndex: 5 })], input);

    expect(result.candidates).toHaveLength(0);
    expect(result.dropped[0].reason).toMatch(/out of range/);
  });
});

describe("validateAndResolveCandidates — category allow-list", () => {
  it("drops a FACTUAL candidate with an out-of-vocabulary category", () => {
    const input = conversationInput("Sí, el TRAVO sirve para Hilux Revo desde 2016.");
    const result = validateAndResolveCandidates([candidate({ proposedCategory: "NOT_A_REAL_CATEGORY" })], input);

    expect(result.candidates).toHaveLength(0);
    expect(result.dropped[0].reason).toMatch(/not valid/);
  });

  it("drops a BEHAVIORAL candidate using a FACTUAL-only category", () => {
    const input = conversationInput("María siempre confirma el año antes de cotizar.");
    const result = validateAndResolveCandidates(
      [
        candidate({
          class: "BEHAVIORAL",
          proposedCategory: "COMPATIBILITY", // valid for FACTUAL, not BEHAVIORAL
          evidenceQuote: "María siempre confirma el año antes de cotizar",
        }),
      ],
      input,
    );

    expect(result.candidates).toHaveLength(0);
  });

  it("accepts a valid BEHAVIORAL candidate with a BehaviorCategory value", () => {
    const input = conversationInput("María siempre confirma el año antes de cotizar.");
    const result = validateAndResolveCandidates(
      [
        candidate({
          class: "BEHAVIORAL",
          proposedCategory: "PROCESS_PATTERN",
          evidenceQuote: "María siempre confirma el año antes de cotizar",
        }),
      ],
      input,
    );

    expect(result.candidates).toHaveLength(1);
  });
});

describe("validateAndResolveCandidates — confidence floor", () => {
  it("drops a candidate below the confidence floor", () => {
    const input = conversationInput("Sí, el TRAVO sirve para Hilux Revo desde 2016.");
    const result = validateAndResolveCandidates([candidate({ confidence: 0.2 })], input);

    expect(result.candidates).toHaveLength(0);
    expect(result.dropped[0].reason).toMatch(/confidence/);
  });

  it("accepts a candidate exactly at the confidence floor", () => {
    const input = conversationInput("Sí, el TRAVO sirve para Hilux Revo desde 2016.");
    const result = validateAndResolveCandidates([candidate({ confidence: 0.5 })], input);
    expect(result.candidates).toHaveLength(1);
  });
});

describe("validateAndResolveCandidates — website section authority (Sprint 8 review, item 8)", () => {
  it("drops a FACTUAL candidate sourced from a TESTIMONIAL section — the exact 'delivery in one day' example", () => {
    const input = documentInput("Llegó en un día, excelente servicio.", "TESTIMONIAL");
    const result = validateAndResolveCandidates(
      [
        candidate({
          proposedCategory: "LOGISTICS",
          subject: "Tiempo de entrega",
          statement: "El tiempo de entrega estándar es un día.",
          evidenceQuote: "Llegó en un día",
        }),
      ],
      input,
    );

    expect(result.candidates).toHaveLength(0);
    expect(result.dropped[0].reason).toMatch(/TESTIMONIAL/);
  });

  it("drops a FACTUAL candidate sourced from a MARKETING section", () => {
    const input = documentInput("¡Los mejores kits del Perú!", "MARKETING");
    const result = validateAndResolveCandidates([candidate({ evidenceQuote: "Los mejores kits del Perú" })], input);

    expect(result.candidates).toHaveLength(0);
    expect(result.dropped[0].reason).toMatch(/MARKETING/);
  });

  it("accepts a FACTUAL candidate sourced from a PRODUCT section", () => {
    const input = documentInput("El TRAVO es compatible con Hilux Revo desde 2016.", "PRODUCT");
    const result = validateAndResolveCandidates([candidate({ evidenceQuote: "TRAVO es compatible con Hilux Revo desde 2016" })], input);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].chunkContext).toBe("PRODUCT");
    expect(result.candidates[0].evidenceRefId).toBe("page-1");
  });

  it("still allows a BEHAVIORAL candidate to pass grounding regardless of section context (behavioral candidates never come from websites in practice, but the rule is FACTUAL-specific)", () => {
    const input = documentInput("Testimonio de cliente satisfecho.", "TESTIMONIAL");
    const result = validateAndResolveCandidates(
      [candidate({ class: "BEHAVIORAL", proposedCategory: "CUSTOMER_PATTERN", evidenceQuote: "Testimonio de cliente satisfecho" })],
      input,
    );

    expect(result.candidates).toHaveLength(1);
  });
});
