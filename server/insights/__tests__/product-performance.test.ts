import { describe, expect, it } from "vitest";
import { deriveProductPerformance } from "../product-performance";
import type { ProductConversion } from "@/server/services/conversion-intelligence-service";

function conversion(overrides: Partial<ProductConversion> = {}): ProductConversion {
  return { product: "Kit TRAVO", closed: 0, lost: 0, decided: 0, conversionRate: 0, ...overrides };
}

describe("deriveProductPerformance", () => {
  it("combines interest and conversion data for the same product into one row", () => {
    const rows = deriveProductPerformance(
      new Map([["Kit TRAVO", 10]]),
      new Map([["Kit TRAVO", 8]]),
      [conversion({ product: "Kit TRAVO", closed: 3, lost: 1, decided: 4, conversionRate: 0.75 })],
    );

    // A single product trivially equals its own average on both axes, so it
    // is classified ESTRELLA here — the "stays unclassified" cases are
    // covered separately below with more than one product to compare against.
    expect(rows).toEqual([
      { product: "Kit TRAVO", interested: 10, interestedPreviousPeriod: 8, trendPercent: 25, closed: 3, lost: 1, decided: 4, conversionRate: 0.75, classification: "ESTRELLA" },
    ]);
  });

  it("includes a product with interest but no decided outcomes yet", () => {
    const rows = deriveProductPerformance(new Map([["Ranger Raptor", 5]]), new Map(), []);
    expect(rows[0]).toMatchObject({ product: "Ranger Raptor", interested: 5, decided: 0, conversionRate: null });
  });

  it("includes a product with decided outcomes but no interest this period", () => {
    const rows = deriveProductPerformance(new Map(), new Map(), [conversion({ product: "Amortiguadores", closed: 2, lost: 0, decided: 2, conversionRate: 1 })]);
    expect(rows[0]).toMatchObject({ product: "Amortiguadores", interested: 0, decided: 2, conversionRate: 1 });
  });

  it("returns null trendPercent when there was no previous-period baseline", () => {
    const rows = deriveProductPerformance(new Map([["Kit TRAVO", 5]]), new Map(), []);
    expect(rows[0].trendPercent).toBeNull();
  });

  it("computes a negative trend when interest dropped", () => {
    const rows = deriveProductPerformance(new Map([["Kit TRAVO", 5]]), new Map([["Kit TRAVO", 10]]), []);
    expect(rows[0].trendPercent).toBe(-50);
  });

  it("sorts by interested descending", () => {
    const rows = deriveProductPerformance(
      new Map([
        ["Low", 2],
        ["High", 20],
      ]),
      new Map(),
      [],
    );
    expect(rows.map((r) => r.product)).toEqual(["High", "Low"]);
  });

  describe("classification", () => {
    it("never classifies a product below the minimum interest threshold, regardless of conversion", () => {
      const rows = deriveProductPerformance(
        new Map([["Niche", 1]]),
        new Map(),
        [conversion({ product: "Niche", closed: 5, lost: 0, decided: 5, conversionRate: 1 })],
      );
      expect(rows[0].classification).toBeNull();
    });

    it("never classifies a product below the minimum decided threshold, regardless of demand", () => {
      const rows = deriveProductPerformance(new Map([["Popular", 20]]), new Map(), [conversion({ product: "Popular", closed: 1, lost: 0, decided: 1, conversionRate: 1 })]);
      expect(rows[0].classification).toBeNull();
    });

    it("classifies ESTRELLA: demand and conversion both above average", () => {
      const rows = deriveProductPerformance(
        new Map([
          ["Star", 20],
          ["Average", 5],
        ]),
        new Map(),
        [conversion({ product: "Star", closed: 8, lost: 2, decided: 10, conversionRate: 0.8 }), conversion({ product: "Average", closed: 1, lost: 1, decided: 2, conversionRate: 0.5 })],
      );
      expect(rows.find((r) => r.product === "Star")?.classification).toBe("ESTRELLA");
    });

    it("classifies OPORTUNIDAD_MEJORA: high demand, below-average conversion (the TRAVO case)", () => {
      const rows = deriveProductPerformance(
        new Map([
          ["Hilux TRAVO", 20],
          ["Kit de embrague", 5],
        ]),
        new Map(),
        [
          conversion({ product: "Hilux TRAVO", closed: 1, lost: 3, decided: 4, conversionRate: 0.25 }),
          conversion({ product: "Kit de embrague", closed: 3, lost: 1, decided: 4, conversionRate: 0.75 }),
        ],
      );
      expect(rows.find((r) => r.product === "Hilux TRAVO")?.classification).toBe("OPORTUNIDAD_MEJORA");
    });

    it("classifies NICHO_RENTABLE: low demand, above-average conversion", () => {
      const rows = deriveProductPerformance(
        new Map([
          ["Popular", 20],
          ["Niche", 3],
        ]),
        new Map(),
        [conversion({ product: "Popular", closed: 2, lost: 2, decided: 4, conversionRate: 0.5 }), conversion({ product: "Niche", closed: 4, lost: 0, decided: 4, conversionRate: 1 })],
      );
      expect(rows.find((r) => r.product === "Niche")?.classification).toBe("NICHO_RENTABLE");
    });

    it("leaves low-demand, low-conversion products unclassified (nothing notable to flag)", () => {
      const rows = deriveProductPerformance(
        new Map([
          ["Popular", 20],
          ["Weak", 3],
        ]),
        new Map(),
        [conversion({ product: "Popular", closed: 3, lost: 1, decided: 4, conversionRate: 0.75 }), conversion({ product: "Weak", closed: 1, lost: 3, decided: 4, conversionRate: 0.25 })],
      );
      expect(rows.find((r) => r.product === "Weak")?.classification).toBeNull();
    });
  });
});
