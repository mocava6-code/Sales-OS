// Gated: proves getLeadSignals against real Postgres — grouping/counting
// logic is simple enough to unit-test, but tenant/lead isolation and the
// real Observation/DomainEvent FK shape are worth proving against a real
// database rather than a mock.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLeadSignals } from "../lead-signal-service";
import { cleanupTestFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "../../persistence/__tests__/test-db";
import type { ObservationType } from "../../intelligence/observation/types";

type Db = ReturnType<typeof getTestPrisma>;

describe.skipIf(!shouldRunDbTests)("getLeadSignals — against real Postgres", () => {
  let db: Db;
  let fixture: TestFixture;

  beforeEach(async () => {
    db = getTestPrisma();
    fixture = await createTestFixture(db, "lead-signals");
  });

  afterEach(async () => {
    await db.observation.deleteMany({ where: { businessId: fixture.businessId } });
    await db.domainEvent.deleteMany({ where: { businessId: fixture.businessId } });
    await cleanupTestFixture(db, fixture);
  });

  async function createSignal(type: ObservationType, occurredAt: Date, excerpt: string, conversationId = fixture.conversationId) {
    const domainEvent = await db.domainEvent.create({
      data: {
        businessId: fixture.businessId,
        conversationId,
        eventType: "MESSAGE_RECEIVED",
        payload: {},
        occurredAt,
      },
    });
    return db.observation.create({
      data: {
        businessId: fixture.businessId,
        conversationId,
        domainEventId: domainEvent.id,
        type,
        summary: `test: ${type}`,
        evidence: [{ sourceType: "conversation_message", sourceId: "msg-1", excerpt }],
        occurredAt,
      },
    });
  }

  it("returns nothing for a lead with no observations", async () => {
    expect(await getLeadSignals(fixture.leadId, fixture.businessId, db)).toEqual([]);
  });

  it("groups by type, counts correctly, and keeps the most recent excerpt", async () => {
    await createSignal("PRICE_OBJECTION", new Date("2026-08-01T10:00:00.000Z"), "está muy caro");
    await createSignal("PRICE_OBJECTION", new Date("2026-08-02T10:00:00.000Z"), "no me alcanza");
    await createSignal("QUOTE_REQUEST", new Date("2026-08-01T11:00:00.000Z"), "quiero una cotización");

    const results = await getLeadSignals(fixture.leadId, fixture.businessId, db);
    const byType = new Map(results.map((r) => [r.type, r]));

    expect(byType.get("PRICE_OBJECTION")).toMatchObject({ count: 2, latestExcerpt: "no me alcanza" });
    expect(byType.get("QUOTE_REQUEST")).toMatchObject({ count: 1, latestExcerpt: "quiero una cotización" });
  });

  it("never includes a signal from a different lead's conversation", async () => {
    const otherFixture = await createTestFixture(db, "lead-signals-other");
    try {
      await createSignal("TRUST_FRICTION", new Date(), "es confiable esto?", otherFixture.conversationId);

      const results = await getLeadSignals(fixture.leadId, fixture.businessId, db);
      expect(results).toEqual([]);
    } finally {
      await db.observation.deleteMany({ where: { businessId: otherFixture.businessId } });
      await db.domainEvent.deleteMany({ where: { businessId: otherFixture.businessId } });
      await cleanupTestFixture(db, otherFixture);
    }
  });
});
