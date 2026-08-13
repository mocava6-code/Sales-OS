// Gated: proves getDataQualityStats fetches real LeadCommercialProfile
// completeness against real Postgres. The percentage math itself is
// already covered exhaustively by deriveDataQualityStats's pure-function
// tests — this file only proves the DB fetch is correctly scoped.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDataQualityStats } from "../data-quality";
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
