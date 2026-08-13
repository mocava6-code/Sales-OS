import { describe, expect, it } from "vitest";
import { deliveryLocationExtractor } from "../extractors/location-extractor";
import type { NormalizedMessageForExtraction } from "../types";

function message(overrides: Partial<NormalizedMessageForExtraction> = {}): NormalizedMessageForExtraction {
  return {
    id: "entry-1",
    conversationId: "conv-1",
    direction: "INBOUND",
    content: "",
    occurredAt: new Date("2026-07-24T09:00:00Z"),
    ...overrides,
  };
}

describe("deliveryLocationExtractor — worked example", () => {
  it("extracts 'Chaclacayo' from the gazetteer tier", () => {
    const [candidate] = deliveryLocationExtractor.extract([message({ content: "hace envíos a chaclacayo?" })]);

    expect(candidate.value).toBe("Chaclacayo");
    expect(candidate.reasoning).toMatch(/distrito\/ciudad conocido/i);
  });
});

describe("deliveryLocationExtractor — general behavior", () => {
  it("returns no candidates for a message with no delivery/location mention", () => {
    expect(deliveryLocationExtractor.extract([message({ content: "hola, cómo estás?" })])).toEqual([]);
  });

  it("falls back to the generic pattern tier for an unrecognized place, at lower confidence", () => {
    const [candidate] = deliveryLocationExtractor.extract([message({ content: "hacen envios a pueblo libre?" })]);

    expect(candidate.value).toBe("Pueblo Libre");
    expect(candidate.reasoning).toMatch(/no es un lugar reconocido/i);
  });

  it("gazetteer-tier candidates carry higher confidence than pattern-fallback ones", () => {
    const [gazetteer] = deliveryLocationExtractor.extract([message({ content: "envios a lima" })]);
    const [fallback] = deliveryLocationExtractor.extract([message({ content: "envios a algun lugar random" })]);

    expect(gazetteer.confidence).toBeGreaterThan(fallback.confidence);
  });

  it("matches 'entregas en X' phrasing, not just 'envíos a X'", () => {
    const [candidate] = deliveryLocationExtractor.extract([message({ content: "hacen entregas en surco?" })]);
    expect(candidate.value).toBe("Surco");
  });

  it("stops the pattern-fallback capture at a trailing clause, not swallowing the rest of the sentence", () => {
    const [candidate] = deliveryLocationExtractor.extract([
      message({ content: "hacen envios a pueblo libre para mañana?" }),
    ]);
    expect(candidate.value).toBe("Pueblo Libre");
  });
});
