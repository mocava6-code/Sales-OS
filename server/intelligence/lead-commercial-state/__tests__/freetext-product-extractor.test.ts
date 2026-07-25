import { describe, expect, it } from "vitest";
import { productInterestExtractor, vehicleModelExtractor } from "../extractors/freetext-product-extractor";
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

describe("freetext product/vehicle extractor — worked example", () => {
  const workedExampleMessage = message({ content: "tiene kit de hilux travo 2026?" });

  it("vehicleModelExtractor produces 'Hilux TRAVO 2026'", () => {
    const [candidate] = vehicleModelExtractor.extract([workedExampleMessage]);
    expect(candidate.value).toBe("Hilux TRAVO 2026");
    expect(candidate.evidence[0].sourceId).toBe("entry-1");
  });

  it("productInterestExtractor produces 'Hilux TRAVO 2026 kit'", () => {
    const [candidate] = productInterestExtractor.extract([workedExampleMessage]);
    expect(candidate.value).toBe("Hilux TRAVO 2026 kit");
  });
});

describe("freetext product/vehicle extractor — general behavior", () => {
  it("returns no candidates for a message with no known vehicle mention", () => {
    expect(vehicleModelExtractor.extract([message({ content: "hola, buenos días" })])).toEqual([]);
    expect(productInterestExtractor.extract([message({ content: "hola, buenos días" })])).toEqual([]);
  });

  it("extracts the bare brand when no product line or year is present", () => {
    const [candidate] = vehicleModelExtractor.extract([message({ content: "tienen para corolla?" })]);
    expect(candidate.value).toBe("Corolla");
  });

  it("omits the product type from vehicleModel but includes it in productInterest", () => {
    const msg = message({ content: "necesito repuestos para hiace 2020" });
    const [vehicleModel] = vehicleModelExtractor.extract([msg]);
    const [productInterest] = productInterestExtractor.extract([msg]);

    expect(vehicleModel.value).toBe("Hiace 2020");
    expect(productInterest.value).toBe("Hiace 2020 repuestos");
  });

  it("matches a multi-word vehicle model (Land Cruiser)", () => {
    const [candidate] = vehicleModelExtractor.extract([message({ content: "tiene kit para land cruiser 2019?" })]);
    expect(candidate.value).toBe("Land Cruiser 2019");
  });

  it("tags every candidate with the free-text tier's lower confidence and evidence", () => {
    const [candidate] = vehicleModelExtractor.extract([message({ content: "hilux 2026" })]);
    expect(candidate.confidence).toBeLessThan(0.9);
    expect(candidate.evidence[0].excerpt).toBe("hilux 2026");
    expect(candidate.reasoning).toMatch(/no product catalog/i);
  });

  it("matches regardless of message direction (advisor confirming the product also counts as evidence)", () => {
    const [candidate] = vehicleModelExtractor.extract([
      message({ direction: "OUTBOUND", content: "si tenemos el kit de hilux travo 2026 en stock" }),
    ]);
    expect(candidate.value).toBe("Hilux TRAVO 2026");
  });
});
