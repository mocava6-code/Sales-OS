import { describe, expect, it } from "vitest";
import { productInterestExtractor, vehicleBrandExtractor, vehicleModelExtractor, vehicleYearExtractor } from "../extractors/freetext-product-extractor";
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

// Kori Data Correctness Phase 1C — vehicleBrand/vehicleModel/vehicleYear/
// productInterest are now four separate fields (previously vehicleModel
// alone carried a compound "Hilux TRAVO 2026" string, and vehicleBrand had
// no deterministic source at all).
describe("freetext product/vehicle extractor — worked example, fields separated", () => {
  const workedExampleMessage = message({ content: "tiene kit de hilux travo 2026?" });

  it("vehicleModelExtractor produces just the clean model name", () => {
    const [candidate] = vehicleModelExtractor.extract([workedExampleMessage]);
    expect(candidate.value).toBe("Hilux");
    expect(candidate.evidence[0].sourceId).toBe("entry-1");
  });

  it("vehicleBrandExtractor infers Toyota from Hilux", () => {
    const [candidate] = vehicleBrandExtractor.extract([workedExampleMessage]);
    expect(candidate.value).toBe("Toyota");
  });

  it("vehicleYearExtractor extracts the 4-digit year", () => {
    const [candidate] = vehicleYearExtractor.extract([workedExampleMessage]);
    expect(candidate.value).toBe(2026);
  });

  it("productInterestExtractor produces the product line + type, without the model/year prefix", () => {
    const [candidate] = productInterestExtractor.extract([workedExampleMessage]);
    expect(candidate.value).toBe("TRAVO kit");
  });
});

describe("freetext product/vehicle extractor — explicit deterministic brand mappings", () => {
  it("Hilux -> Toyota", () => {
    const [candidate] = vehicleBrandExtractor.extract([message({ content: "tienen para hilux?" })]);
    expect(candidate.value).toBe("Toyota");
  });

  it("Fortuner -> Toyota", () => {
    const [candidate] = vehicleBrandExtractor.extract([message({ content: "tienen para fortuner?" })]);
    expect(candidate.value).toBe("Toyota");
  });

  it("Ranger -> Ford", () => {
    const [candidate] = vehicleBrandExtractor.extract([message({ content: "tienen para ranger?" })]);
    expect(candidate.value).toBe("Ford");
  });

  it("F-150 -> Ford", () => {
    const [candidate] = vehicleBrandExtractor.extract([message({ content: "tienen para f-150?" })]);
    expect(candidate.value).toBe("Ford");
  });

  it("F150 (no separator) -> Ford", () => {
    const [candidate] = vehicleBrandExtractor.extract([message({ content: "tienen para f150?" })]);
    expect(candidate.value).toBe("Ford");
  });

  it("F 150 (space) -> Ford", () => {
    const [candidate] = vehicleBrandExtractor.extract([message({ content: "tienen para f 150?" })]);
    expect(candidate.value).toBe("Ford");
  });

  it("Raptor ALONE does not infer a brand — no candidate produced", () => {
    expect(vehicleBrandExtractor.extract([message({ content: "tienen para raptor?" })])).toEqual([]);
  });

  it("Ford Raptor DOES infer Ford", () => {
    const [candidate] = vehicleBrandExtractor.extract([message({ content: "tienen para ford raptor?" })]);
    expect(candidate.value).toBe("Ford");
  });

  it("Raptor + F150 in the same message also infers Ford", () => {
    const [candidate] = vehicleBrandExtractor.extract([message({ content: "es el mismo raptor que el f150?" })]);
    expect(candidate.value).toBe("Ford");
  });

  it("vehicleModel still recognizes Raptor as a model regardless of brand ambiguity", () => {
    const [candidate] = vehicleModelExtractor.extract([message({ content: "tienen para raptor?" })]);
    expect(candidate.value).toBe("Raptor");
  });

  it("never fuzzy-infers a brand for an unrecognized model", () => {
    expect(vehicleBrandExtractor.extract([message({ content: "tienen para wrangler?" })])).toEqual([]);
  });
});

describe("freetext product/vehicle extractor — general behavior", () => {
  it("returns no candidates for a message with no known vehicle mention", () => {
    expect(vehicleModelExtractor.extract([message({ content: "hola, buenos días" })])).toEqual([]);
    expect(vehicleBrandExtractor.extract([message({ content: "hola, buenos días" })])).toEqual([]);
    expect(vehicleYearExtractor.extract([message({ content: "hola, buenos días" })])).toEqual([]);
    expect(productInterestExtractor.extract([message({ content: "hola, buenos días" })])).toEqual([]);
  });

  it("extracts the bare model when no product line or year is present, with no year candidate", () => {
    const [candidate] = vehicleModelExtractor.extract([message({ content: "tienen para corolla?" })]);
    expect(candidate.value).toBe("Corolla");
    expect(vehicleYearExtractor.extract([message({ content: "tienen para corolla?" })])).toEqual([]);
  });

  it("year and product type are extracted as their own separate fields (model/year/product-interest separation)", () => {
    const msg = message({ content: "necesito repuestos para hiace 2020" });
    const [vehicleModel] = vehicleModelExtractor.extract([msg]);
    const [vehicleYear] = vehicleYearExtractor.extract([msg]);
    const [productInterest] = productInterestExtractor.extract([msg]);

    expect(vehicleModel.value).toBe("Hiace");
    expect(vehicleYear.value).toBe(2020);
    expect(productInterest.value).toBe("repuestos");
  });

  it("matches a multi-word vehicle model (Land Cruiser) and its year separately", () => {
    const msg = message({ content: "tiene kit para land cruiser 2019?" });
    const [vehicleModel] = vehicleModelExtractor.extract([msg]);
    const [vehicleYear] = vehicleYearExtractor.extract([msg]);
    expect(vehicleModel.value).toBe("Land Cruiser");
    expect(vehicleYear.value).toBe(2019);
  });

  it("tags every candidate with the free-text tier's lower confidence and evidence", () => {
    const [candidate] = vehicleModelExtractor.extract([message({ content: "hilux 2026" })]);
    expect(candidate.confidence).toBeLessThan(0.9);
    expect(candidate.evidence[0].excerpt).toBe("hilux 2026");
    expect(candidate.reasoning).toMatch(/catálogo de productos configurado/i);
  });

  it("matches regardless of message direction (advisor confirming the product also counts as evidence)", () => {
    const [candidate] = vehicleModelExtractor.extract([
      message({ direction: "OUTBOUND", content: "si tenemos el kit de hilux travo 2026 en stock" }),
    ]);
    expect(candidate.value).toBe("Hilux");
  });

  it("produces no productInterest candidate when no product line is mentioned, even with a recognized model", () => {
    expect(productInterestExtractor.extract([message({ content: "tienen para hilux?" })])).toEqual([]);
  });
});
