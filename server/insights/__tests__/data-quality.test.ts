import { describe, expect, it } from "vitest";
import { deriveDataQualityStats, type LeadForDataQuality } from "../data-quality";

function lead(overrides: Partial<{ customerType: string | null; vehicleBrand: string | null; productInterest: string | null }> = {}): LeadForDataQuality {
  return {
    commercialProfile: { customerType: "RETAIL", vehicleBrand: "Toyota", productInterest: "Kit TRAVO", ...overrides },
  };
}

describe("deriveDataQualityStats", () => {
  it("computes missingCount/totalCount/missingPercentage per field", () => {
    const stats = deriveDataQualityStats([lead(), lead({ customerType: null }), lead({ customerType: null }), lead()]);
    const customerType = stats.find((s) => s.field === "customerType")!;
    expect(customerType).toEqual({ field: "customerType", missingCount: 2, totalCount: 4, missingPercentage: 50 });
  });

  it("counts a lead with no commercialProfile at all as missing every field", () => {
    const stats = deriveDataQualityStats([{ commercialProfile: null }]);
    expect(stats.every((s) => s.missingCount === 1)).toBe(true);
  });

  it("returns 0% missing for a field nobody is missing", () => {
    const stats = deriveDataQualityStats([lead(), lead(), lead()]);
    expect(stats.every((s) => s.missingPercentage === 0)).toBe(true);
  });

  it("returns 0% (not NaN or a division error) for a business with zero leads", () => {
    const stats = deriveDataQualityStats([]);
    expect(stats.every((s) => s.missingPercentage === 0 && s.totalCount === 0)).toBe(true);
  });

  it("always returns all three tracked fields, even when none are missing", () => {
    const stats = deriveDataQualityStats([lead()]);
    expect(stats.map((s) => s.field).sort()).toEqual(["customerType", "productInterest", "vehicleBrand"]);
  });

  it("tracks each field independently — one field missing doesn't affect another's count", () => {
    const stats = deriveDataQualityStats([lead({ vehicleBrand: null }), lead()]);
    expect(stats.find((s) => s.field === "vehicleBrand")!.missingCount).toBe(1);
    expect(stats.find((s) => s.field === "customerType")!.missingCount).toBe(0);
  });
});
