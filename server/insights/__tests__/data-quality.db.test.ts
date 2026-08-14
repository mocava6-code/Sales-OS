// Gated: proves getDataQualityStats fetches real LeadCommercialProfile
// completeness against real Postgres. The percentage math itself is
// already covered exhaustively by deriveDataQualityStats's pure-function
// tests — this file only proves the DB fetch is correctly scoped.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCustomerTypeCoverage, getDataQualityStats } from "../data-quality";
import { cleanupTestFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "../../persistence/__tests__/test-db";

describe.skipIf(!shouldRunDbTests)("getDataQualityStats (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "data-quality");
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
  });

  it("counts a lead with no commercialProfile row at all as missing every field", async () => {
    const stats = await getDataQualityStats(fixture.businessId, db!);
    expect(stats.every((s) => s.totalCount === 1 && s.missingCount === 1 && s.missingPercentage === 100)).toBe(true);
  });

  it("counts a real commercialProfile's populated fields as present", async () => {
    await db!.leadCommercialProfile.create({ data: { leadId: fixture.leadId, businessId: fixture.businessId, customerType: "RETAIL", vehicleBrand: "Toyota" } });

    const stats = await getDataQualityStats(fixture.businessId, db!);

    expect(stats.find((s) => s.field === "customerType")!.missingCount).toBe(0);
    expect(stats.find((s) => s.field === "vehicleBrand")!.missingCount).toBe(0);
    expect(stats.find((s) => s.field === "productInterest")!.missingCount).toBe(1);
  });

  it("scopes the count to the requesting business only (tenant isolation)", async () => {
    const otherFixture = await createTestFixture(db!, "data-quality-other");
    try {
      await db!.leadCommercialProfile.create({ data: { leadId: otherFixture.leadId, businessId: otherFixture.businessId, customerType: "WHOLESALE", vehicleBrand: "Ford", productInterest: "Kit" } });

      const stats = await getDataQualityStats(fixture.businessId, db!);

      expect(stats.every((s) => s.totalCount === 1)).toBe(true);
    } finally {
      await cleanupTestFixture(db!, otherFixture);
    }
  });
});

describe.skipIf(!shouldRunDbTests)("getCustomerTypeCoverage (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "customer-type-coverage");
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
  });

  it("reads real provenance JSON and classifies via the same rule as classifyCustomerType", async () => {
    await db!.leadCommercialProfile.create({
      data: {
        leadId: fixture.leadId,
        businessId: fixture.businessId,
        customerType: "RETAIL",
        provenance: { customerType: { source: "LEAD_COMMERCIAL_STATE", confidence: 0.9, snapshotId: null, updatedAt: new Date().toISOString() } },
      },
    });

    const coverage = await getCustomerTypeCoverage(fixture.businessId, db!);

    expect(coverage).toEqual({ totalCount: 1, confirmedCount: 1, inferredRetailCount: 0, inferredWholesaleCount: 0, insufficientEvidenceCount: 0 });
  });

  it("counts a lead with no commercialProfile row as insufficient evidence", async () => {
    const coverage = await getCustomerTypeCoverage(fixture.businessId, db!);
    expect(coverage).toEqual({ totalCount: 1, confirmedCount: 0, inferredRetailCount: 0, inferredWholesaleCount: 0, insufficientEvidenceCount: 1 });
  });

  it("scopes the count to the requesting business only (tenant isolation)", async () => {
    const otherFixture = await createTestFixture(db!, "customer-type-coverage-other");
    try {
      await db!.leadCommercialProfile.create({
        data: {
          leadId: otherFixture.leadId,
          businessId: otherFixture.businessId,
          customerType: "WHOLESALE",
          provenance: { customerType: { source: "LEAD_COMMERCIAL_STATE", confidence: 0.9, snapshotId: null, updatedAt: new Date().toISOString() } },
        },
      });

      const coverage = await getCustomerTypeCoverage(fixture.businessId, db!);

      expect(coverage.totalCount).toBe(1);
      expect(coverage.confirmedCount).toBe(0);
    } finally {
      await cleanupTestFixture(db!, otherFixture);
    }
  });
});
