// Gated: proves getTeamPerformance's Prisma queries are correctly scoped
// against real Postgres. The comparison/highlight math itself is already
// covered exhaustively by deriveTeamPerformance's pure-function tests — this
// file only proves the DB fetch (leads → conversations → outcomes, joined by
// assigned advisor) feeds it the right rows.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTeamPerformance } from "../team-performance";
import { cleanupTestFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "../../persistence/__tests__/test-db";

describe.skipIf(!shouldRunDbTests)("getTeamPerformance (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: TestFixture;

  beforeEach(async () => {
    // createTestFixture already assigns the lead (and its one conversation)
    // to fixture.userId — exactly the join this function relies on.
    fixture = await createTestFixture(db!, "team-performance");
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
  });

  it("counts the fixture's conversation against its assigned advisor", async () => {
    const summary = await getTeamPerformance(fixture.businessId, new Date(), db!);

    expect(summary.advisors).toHaveLength(1);
    expect(summary.advisors[0].advisorUserId).toBe(fixture.userId);
    expect(summary.advisors[0].conversationsHandled).toBe(1);
    expect(summary.advisors[0].decided).toBe(0);
  });

  it("rolls a SALE_CLOSED outcome into both the advisor's and the team's conversion rate", async () => {
    await db!.outcome.create({
      data: { businessId: fixture.businessId, conversationId: fixture.conversationId, outcomeType: "SALE_CLOSED", attribution: "UNATTRIBUTED" },
    });

    const summary = await getTeamPerformance(fixture.businessId, new Date(), db!);

    expect(summary.advisors[0].decided).toBe(1);
    expect(summary.advisors[0].closed).toBe(1);
    expect(summary.advisors[0].conversionRate).toBe(1);
    expect(summary.teamAverage.conversionRate).toBe(1);
  });

  it("excludes an outcome recorded outside the lookback period", async () => {
    const longAgo = new Date("2020-01-01T00:00:00.000Z");
    await db!.outcome.create({
      data: { businessId: fixture.businessId, conversationId: fixture.conversationId, outcomeType: "SALE_LOST", attribution: "UNATTRIBUTED", occurredAt: longAgo },
    });

    const summary = await getTeamPerformance(fixture.businessId, new Date(), db!);

    expect(summary.advisors[0].decided).toBe(0);
  });

  it("scopes to the requesting business only (tenant isolation)", async () => {
    const otherFixture = await createTestFixture(db!, "team-performance-other");
    try {
      const summary = await getTeamPerformance(fixture.businessId, new Date(), db!);

      expect(summary.advisors.every((a) => a.advisorUserId !== otherFixture.userId)).toBe(true);
    } finally {
      await cleanupTestFixture(db!, otherFixture);
    }
  });
});
