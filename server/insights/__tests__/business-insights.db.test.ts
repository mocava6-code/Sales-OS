// Gated: proves the three Business Insights Engine orchestrators
// (getProductPerformance, getLossAnalysis, getTeamPerformance) wire their
// Prisma queries together correctly against real Postgres. The math itself
// (classification, bucketing, highlight gating) is already covered
// exhaustively by the pure-function unit tests in this directory — this
// file only needs to prove the DB fetch → derive pipeline is correct.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getProductPerformance } from "../product-performance";
import { getLossAnalysis } from "../loss-analysis";
import { getTeamPerformance } from "../team-performance";
import { fetchFirstResponseMinutesByConversationId } from "../response-time";
import { cleanupTestFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "../../persistence/__tests__/test-db";

describe.skipIf(!shouldRunDbTests)("Business Insights Engine orchestrators (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: TestFixture;
  // Captured fresh per test, AFTER the fixture's own Lead/Conversation are
  // created (createTestFixture stamps their createdAt/lastEntryAt with the
  // real current time) — every relative timestamp below is expressed as an
  // offset from this, so the fixture's own rows always fall inside the
  // orchestrators' [now - 30d, now] window regardless of when the test runs.
  let now: Date;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "business-insights");
    now = new Date();
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
  });

  it("getProductPerformance: counts interested leads and decided outcomes for a product within the period", async () => {
    await db!.leadCommercialProfile.create({ data: { leadId: fixture.leadId, businessId: fixture.businessId, productInterest: "Kit TRAVO" } });
    await db!.outcome.create({
      data: { businessId: fixture.businessId, conversationId: fixture.conversationId, outcomeType: "SALE_CLOSED", productSold: "Kit TRAVO", occurredAt: now, attribution: "UNATTRIBUTED" },
    });

    const result = await getProductPerformance(fixture.businessId, now, db!);

    const row = result.products.find((p) => p.product === "Kit TRAVO");
    expect(row).toMatchObject({ interested: 1, closed: 1, lost: 0, decided: 1, conversionRate: 1 });
  });

  it("getLossAnalysis: buckets a lost outcome by its conversation's response time and includes its lostReason", async () => {
    await db!.conversationEntry.createMany({
      data: [
        { conversationId: fixture.conversationId, direction: "INBOUND", content: "Cuánto cuesta?", occurredAt: new Date(now.getTime() - 20 * 60 * 1000) },
        { conversationId: fixture.conversationId, direction: "OUTBOUND", content: "350 soles", occurredAt: new Date(now.getTime() - 10 * 60 * 1000) },
      ],
    });
    await db!.outcome.create({
      data: { businessId: fixture.businessId, conversationId: fixture.conversationId, outcomeType: "SALE_LOST", lostReason: "PRECIO", occurredAt: now, attribution: "UNATTRIBUTED" },
    });

    const result = await getLossAnalysis(fixture.businessId, now, db!);

    expect(result.totalLost).toBe(1);
    expect(result.lostReasonBreakdown).toEqual([{ reason: "PRECIO", label: "Precio", count: 1, percentage: 100 }]);
    const under30 = result.responseTimeBuckets.find((b) => b.bucket === "UNDER_30_MIN")!;
    expect(under30).toMatchObject({ decided: 1, closed: 0 });
  });

  it("getTeamPerformance: attributes a conversation and its outcome to the lead's assigned advisor", async () => {
    await db!.outcome.create({
      data: { businessId: fixture.businessId, conversationId: fixture.conversationId, outcomeType: "SALE_CLOSED", occurredAt: now, attribution: "UNATTRIBUTED" },
    });

    const result = await getTeamPerformance(fixture.businessId, now, db!);

    const advisor = result.advisors.find((a) => a.advisorUserId === fixture.userId);
    expect(advisor).toMatchObject({ conversationsHandled: 1, decided: 1, closed: 1, conversionRate: 1 });
  });

  it("fetchFirstResponseMinutesByConversationId: resolves real conversation entries into a per-conversation minutes map", async () => {
    await db!.conversationEntry.createMany({
      data: [
        { conversationId: fixture.conversationId, direction: "INBOUND", content: "Hola", occurredAt: new Date(now.getTime() - 45 * 60 * 1000) },
        { conversationId: fixture.conversationId, direction: "OUTBOUND", content: "Hola, en qué te ayudo?", occurredAt: now },
      ],
    });

    const result = await fetchFirstResponseMinutesByConversationId([fixture.conversationId], db!);

    expect(result.get(fixture.conversationId)).toBe(45);
  });

  it("scopes every orchestrator to the requesting business only (tenant isolation)", async () => {
    const otherFixture = await createTestFixture(db!, "business-insights-other");
    try {
      await db!.leadCommercialProfile.create({ data: { leadId: otherFixture.leadId, businessId: otherFixture.businessId, productInterest: "Producto de otro negocio" } });
      await db!.outcome.create({
        data: { businessId: otherFixture.businessId, conversationId: otherFixture.conversationId, outcomeType: "SALE_CLOSED", occurredAt: now, attribution: "UNATTRIBUTED" },
      });

      const [productResult, teamResult] = await Promise.all([getProductPerformance(fixture.businessId, now, db!), getTeamPerformance(fixture.businessId, now, db!)]);

      expect(productResult.products.some((p) => p.product === "Producto de otro negocio")).toBe(false);
      expect(teamResult.advisors.some((a) => a.advisorUserId === otherFixture.userId)).toBe(false);
    } finally {
      await cleanupTestFixture(db!, otherFixture);
    }
  });
});
