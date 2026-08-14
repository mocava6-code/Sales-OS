import { describe, expect, it } from "vitest";
import { deriveCustomerTypeCoverage, deriveDataQualityStats, type LeadForCustomerTypeCoverage, type LeadForDataQuality } from "../data-quality";

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

function coverageLead(customerType: "RETAIL" | "WHOLESALE" | null, provenance: unknown = null): LeadForCustomerTypeCoverage {
  return { commercialProfile: { customerType, provenance } };
}

describe("deriveCustomerTypeCoverage", () => {
  it("classifies a null-customerType lead as insufficient evidence", () => {
    const coverage = deriveCustomerTypeCoverage([{ commercialProfile: null }, coverageLead(null)]);
    expect(coverage).toEqual({ totalCount: 2, confirmedCount: 0, inferredRetailCount: 0, inferredWholesaleCount: 0, insufficientEvidenceCount: 2 });
  });

  it("classifies a deterministic (LEAD_COMMERCIAL_STATE) customerType as confirmed, regardless of RETAIL/WHOLESALE", () => {
    const coverage = deriveCustomerTypeCoverage([
      coverageLead("RETAIL", { customerType: { source: "LEAD_COMMERCIAL_STATE", confidence: 0.9 } }),
      coverageLead("WHOLESALE", { customerType: { source: "LEAD_COMMERCIAL_STATE", confidence: 0.9 } }),
    ]);
    expect(coverage.confirmedCount).toBe(2);
    expect(coverage.inferredRetailCount).toBe(0);
    expect(coverage.inferredWholesaleCount).toBe(0);
  });

  it("splits a moderate-confidence AI (CONVERSATION_SNAPSHOT) customerType into inferred RETAIL/WHOLESALE buckets", () => {
    const coverage = deriveCustomerTypeCoverage([
      coverageLead("RETAIL", { customerType: { source: "CONVERSATION_SNAPSHOT", confidence: 0.7 } }),
      coverageLead("WHOLESALE", { customerType: { source: "CONVERSATION_SNAPSHOT", confidence: 0.65 } }),
    ]);
    expect(coverage.inferredRetailCount).toBe(1);
    expect(coverage.inferredWholesaleCount).toBe(1);
    expect(coverage.confirmedCount).toBe(0);
  });

  it("classifies a high-confidence AI customerType as confirmed", () => {
    const coverage = deriveCustomerTypeCoverage([coverageLead("WHOLESALE", { customerType: { source: "CONVERSATION_SNAPSHOT", confidence: 0.9 } })]);
    expect(coverage.confirmedCount).toBe(1);
    expect(coverage.inferredWholesaleCount).toBe(0);
  });

  it("returns all-zero counts (not NaN) for a business with zero leads", () => {
    expect(deriveCustomerTypeCoverage([])).toEqual({ totalCount: 0, confirmedCount: 0, inferredRetailCount: 0, inferredWholesaleCount: 0, insufficientEvidenceCount: 0 });
  });
});
