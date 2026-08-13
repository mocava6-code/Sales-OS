import { describe, expect, it } from "vitest";
import { buildConversionInsight, deriveProductConversion } from "../conversion-intelligence-service";

function row(overrides: Partial<Parameters<typeof deriveProductConversion>[0][number]> = {}) {
  return {
    outcomeType: "SALE_CLOSED" as const,
    productSold: null,
    occurredAt: new Date("2026-08-10T10:00:00.000Z"),
    conversationCreatedAt: new Date("2026-08-01T10:00:00.000Z"),
    productInterest: null,
    ...overrides,
  };
}

describe("deriveProductConversion", () => {
  it("groups by productSold, computing closed/lost/decided/conversionRate", () => {
    const rows = [
      row({ productSold: "Kit TRAVO", outcomeType: "SALE_CLOSED" }),
      row({ productSold: "Kit TRAVO", outcomeType: "SALE_CLOSED" }),
      row({ productSold: "Kit TRAVO", outcomeType: "SALE_LOST" }),
    ];

    const result = deriveProductConversion(rows);

    expect(result).toEqual([{ product: "Kit TRAVO", closed: 2, lost: 1, decided: 3, conversionRate: 2 / 3 }]);
  });

  it("falls back to productInterest when productSold is null", () => {
    const rows = [row({ productSold: null, productInterest: "Hilux TRAVO", outcomeType: "SALE_CLOSED" })];

    const result = deriveProductConversion(rows);

    expect(result).toEqual([{ product: "Hilux TRAVO", closed: 1, lost: 0, decided: 1, conversionRate: 1 }]);
  });

  it("skips rows with neither productSold nor productInterest", () => {
    const rows = [row({ productSold: null, productInterest: null })];

    expect(deriveProductConversion(rows)).toEqual([]);
  });

  it("sorts groups by decided count descending", () => {
    const rows = [
      row({ productSold: "A", outcomeType: "SALE_CLOSED" }),
      row({ productSold: "B", outcomeType: "SALE_CLOSED" }),
      row({ productSold: "B", outcomeType: "SALE_LOST" }),
    ];

    const result = deriveProductConversion(rows);

    expect(result.map((r) => r.product)).toEqual(["B", "A"]);
  });
});

describe("buildConversionInsight", () => {
  const demandSignals = [
    { label: "Hilux TRAVO", count: 20 },
    { label: "Kit de embrague", count: 10 },
  ];

  it("returns null when fewer than 2 products have enough decided outcomes", () => {
    const productConversion = [{ product: "Hilux TRAVO", closed: 1, lost: 0, decided: 1, conversionRate: 1 }];

    expect(buildConversionInsight(demandSignals, productConversion)).toBeNull();
  });

  it("returns null when fewer than 2 eligible products overlap with demand signals", () => {
    const productConversion = [
      { product: "Hilux TRAVO", closed: 1, lost: 1, decided: 2, conversionRate: 0.5 },
      { product: "Unrelated Product", closed: 2, lost: 0, decided: 2, conversionRate: 1 },
    ];

    expect(buildConversionInsight(demandSignals, productConversion)).toBeNull();
  });

  it("returns null when the top-demand product converts at or above the others' average", () => {
    const productConversion = [
      { product: "Hilux TRAVO", closed: 2, lost: 0, decided: 2, conversionRate: 1 },
      { product: "Kit de embrague", closed: 1, lost: 1, decided: 2, conversionRate: 0.5 },
    ];

    expect(buildConversionInsight(demandSignals, productConversion)).toBeNull();
  });

  it("names the top-demand product and its best-converting rival when the top-demand product underconverts", () => {
    const productConversion = [
      { product: "Hilux TRAVO", closed: 1, lost: 3, decided: 4, conversionRate: 0.25 },
      { product: "Kit de embrague", closed: 3, lost: 1, decided: 4, conversionRate: 0.75 },
    ];

    const insight = buildConversionInsight(demandSignals, productConversion);

    expect(insight).toBe("Kori detecta que Hilux TRAVO tiene más intención pero menor conversión que Kit de embrague.");
  });

  it("picks the best-converting rival among several others, not just the first", () => {
    const productConversion = [
      { product: "Hilux TRAVO", closed: 1, lost: 3, decided: 4, conversionRate: 0.25 },
      { product: "Kit de embrague", closed: 1, lost: 3, decided: 4, conversionRate: 0.25 },
      { product: "Amortiguadores", closed: 3, lost: 1, decided: 4, conversionRate: 0.75 },
    ];
    const signals = [
      { label: "Hilux TRAVO", count: 20 },
      { label: "Kit de embrague", count: 15 },
      { label: "Amortiguadores", count: 5 },
    ];

    const insight = buildConversionInsight(signals, productConversion);

    expect(insight).toBe("Kori detecta que Hilux TRAVO tiene más intención pero menor conversión que Amortiguadores.");
  });
});
