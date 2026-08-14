import { describe, expect, it } from "vitest";
import { customerTypeExtractor } from "../extractors/customer-type-extractor";
import type { NormalizedMessageForExtraction } from "../types";

function message(overrides: Partial<NormalizedMessageForExtraction> = {}): NormalizedMessageForExtraction {
  return {
    id: "entry-1",
    conversationId: "conv-1",
    direction: "INBOUND",
    content: "",
    occurredAt: new Date("2026-08-11T18:47:00Z"),
    ...overrides,
  };
}

describe("customerTypeExtractor", () => {
  it("the exact real production regression case: advisor asks, customer answers 'Cliente final' -> RETAIL", () => {
    const candidates = customerTypeExtractor.extract([
      message({ id: "adv-1", direction: "OUTBOUND", content: "¡Hola! ¿Coménteme es cliente final o distribuidor?", occurredAt: new Date("2026-08-11T18:46:00Z") }),
      message({ id: "cust-1", direction: "INBOUND", content: "Cliente final", occurredAt: new Date("2026-08-11T18:47:00Z") }),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].value).toBe("RETAIL");
    expect(candidates[0].evidence[0].sourceId).toBe("cust-1");
    expect(candidates[0].evidence[0].excerpt).toBe("Cliente final");
  });

  it("detects WHOLESALE from a direct customer answer", () => {
    const candidates = customerTypeExtractor.extract([message({ content: "Distribuidor" })]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].value).toBe("WHOLESALE");
  });

  it("detects WHOLESALE from a short reply variant seen in production ('A distribuidor')", () => {
    const candidates = customerTypeExtractor.extract([message({ content: "A distribuidor" })]);

    expect(candidates[0].value).toBe("WHOLESALE");
  });

  it("never produces a candidate from the advisor's own question", () => {
    const candidates = customerTypeExtractor.extract([
      message({ direction: "OUTBOUND", content: "¿Coménteme es cliente final o distribuidor?" }),
    ]);

    expect(candidates).toEqual([]);
  });

  it("withholds the candidate entirely on a negated statement — never guesses the opposite", () => {
    const wholesaleNegated = customerTypeExtractor.extract([message({ content: "No soy distribuidor, compro para mi mismo" })]);
    const retailNegated = customerTypeExtractor.extract([message({ content: "No es cliente final, somos distribuidor" })]);

    expect(wholesaleNegated).toEqual([]);
    expect(retailNegated).toEqual([]);
  });

  it("returns no candidates for an ordinary message", () => {
    const candidates = customerTypeExtractor.extract([message({ content: "Hola, buenos días" })]);
    expect(candidates).toEqual([]);
  });

  it("matches accented and unaccented keyword variants identically", () => {
    const accented = customerTypeExtractor.extract([message({ content: "Cliente final" })]);
    const unaccented = customerTypeExtractor.extract([message({ content: "cliente final" })]);

    expect(accented[0].value).toBe("RETAIL");
    expect(unaccented[0].value).toBe("RETAIL");
  });

  it("carries the extractor's stable id/version for provenance", () => {
    expect(customerTypeExtractor.id).toBe("deterministic.customer_type");
    expect(customerTypeExtractor.version).toBeTruthy();
  });
});
