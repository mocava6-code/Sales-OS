import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ObservationType } from "../../intelligence/observation/types";
import { PrismaConversationSearchRepository } from "../prisma/prisma-conversation-search-repository";
import { MAX_CONVERSATION_SEARCH_RESULTS } from "../types";
import { cleanupTestFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "./test-db";

describe.skipIf(!shouldRunDbTests)("PrismaConversationSearchRepository (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  const repo = db ? new PrismaConversationSearchRepository(db) : undefined;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "conversation-search");
  });

  afterEach(async () => {
    // Sweep every extra Conversation/Lead this suite created beyond the base
    // fixture's own one — must happen before cleanupTestFixture deletes the
    // business, or its FK blocks it. Mirrors gateway.db.test.ts's pattern.
    const extraConversations = await db!.conversation.findMany({
      where: { businessId: fixture.businessId, id: { not: fixture.conversationId } },
      select: { id: true, leadId: true },
    });
    const extraConversationIds = extraConversations.map((c) => c.id);
    if (extraConversationIds.length > 0) {
      await db!.observation.deleteMany({ where: { conversationId: { in: extraConversationIds } } });
      await db!.domainEvent.deleteMany({ where: { conversationId: { in: extraConversationIds } } });
      await db!.conversationEntry.deleteMany({ where: { conversationId: { in: extraConversationIds } } });
      await db!.conversation.deleteMany({ where: { id: { in: extraConversationIds } } });
    }
    const extraLeadIds = [...new Set(extraConversations.map((c) => c.leadId))].filter((id) => id !== fixture.leadId);
    if (extraLeadIds.length > 0) {
      await db!.lead.deleteMany({ where: { id: { in: extraLeadIds } } });
    }

    await cleanupTestFixture(db!, fixture);
  });

  async function createConversation(overrides: {
    leadName?: string;
    leadPhone?: string;
    lastEntryAt?: Date;
    businessId?: string;
    observationType?: ObservationType;
  } = {}) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const businessId = overrides.businessId ?? fixture.businessId;
    const lead = await db!.lead.create({
      data: { businessId, name: overrides.leadName ?? `Lead ${suffix}`, phone: overrides.leadPhone ?? `+1${suffix}` },
    });
    const conversation = await db!.conversation.create({
      data: {
        businessId,
        leadId: lead.id,
        source: "MANUAL_PASTE",
        lastEntryAt: overrides.lastEntryAt ?? new Date(),
        lastEntryDirection: "INBOUND",
      },
    });
    if (overrides.observationType) {
      const event = await db!.domainEvent.create({
        data: {
          businessId,
          conversationId: conversation.id,
          eventType: "MESSAGE_RECEIVED",
          payload: {},
          occurredAt: new Date(),
        },
      });
      await db!.observation.create({
        data: {
          businessId,
          conversationId: conversation.id,
          domainEventId: event.id,
          type: overrides.observationType,
          summary: "test",
          evidence: [],
          occurredAt: new Date(),
        },
      });
    }
    return { conversation, lead };
  }

  it("matches searchText against the lead's name, case-insensitively", async () => {
    await createConversation({ leadName: "Maria Gonzalez" });
    await createConversation({ leadName: "Carlos Ruiz" });

    const results = await repo!.search(fixture.businessId, { searchText: "maria" });

    expect(results.map((r) => r.leadName)).toContain("Maria Gonzalez");
    expect(results.map((r) => r.leadName)).not.toContain("Carlos Ruiz");
  });

  it("matches searchText against the lead's phone", async () => {
    await createConversation({ leadPhone: "+525512345678" });
    await createConversation({ leadPhone: "+525599999999" });

    const results = await repo!.search(fixture.businessId, { searchText: "12345678" });

    expect(results.map((r) => r.leadPhone)).toContain("+525512345678");
    expect(results.map((r) => r.leadPhone)).not.toContain("+525599999999");
  });

  it("filters by occurredAfter/occurredBefore against lastEntryAt", async () => {
    await createConversation({ lastEntryAt: new Date("2026-01-01T00:00:00Z") });
    const { conversation: inRange } = await createConversation({ lastEntryAt: new Date("2026-06-15T00:00:00Z") });
    await createConversation({ lastEntryAt: new Date("2026-12-31T00:00:00Z") });

    const results = await repo!.search(fixture.businessId, {
      occurredAfter: new Date("2026-06-01T00:00:00Z"),
      occurredBefore: new Date("2026-06-30T00:00:00Z"),
    });

    expect(results.map((r) => r.id)).toEqual([inRange.id]);
  });

  it("observationState HAS_ANY returns only conversations with at least one observation", async () => {
    const { conversation: withObservation } = await createConversation({ observationType: "PRICE_REQUEST" });
    await createConversation();

    const results = await repo!.search(fixture.businessId, { observationState: "HAS_ANY" });

    expect(results.map((r) => r.id)).toEqual([withObservation.id]);
  });

  it("observationState HAS_NONE returns only conversations with zero observations", async () => {
    await createConversation({ observationType: "PRICE_REQUEST" });
    const { conversation: withoutObservation } = await createConversation();

    const results = await repo!.search(fixture.businessId, { observationState: "HAS_NONE" });

    expect(results.map((r) => r.id)).toContain(withoutObservation.id);
  });

  it("hasObservationType filters to conversations carrying that specific type", async () => {
    const { conversation: priceRequest } = await createConversation({ observationType: "PRICE_REQUEST" });
    await createConversation({ observationType: "DISCOUNT_NEGOTIATION" });

    const results = await repo!.search(fixture.businessId, { hasObservationType: "PRICE_REQUEST" });

    expect(results.map((r) => r.id)).toEqual([priceRequest.id]);
  });

  it("reports observationCount per conversation", async () => {
    const { conversation } = await createConversation({ observationType: "PRICE_REQUEST" });
    const event = await db!.domainEvent.create({
      data: {
        businessId: fixture.businessId,
        conversationId: conversation.id,
        eventType: "MESSAGE_RECEIVED",
        payload: {},
        occurredAt: new Date(),
      },
    });
    await db!.observation.create({
      data: {
        businessId: fixture.businessId,
        conversationId: conversation.id,
        domainEventId: event.id,
        type: "DISCOUNT_NEGOTIATION",
        summary: "test",
        evidence: [],
        occurredAt: new Date(),
      },
    });

    const results = await repo!.search(fixture.businessId, {});
    const found = results.find((r) => r.id === conversation.id);

    expect(found?.observationCount).toBe(2);
  });

  it("never returns another business's conversations, even with an empty filter", async () => {
    const otherBusiness = await db!.business.create({ data: { name: `other-business-${Date.now()}` } });
    const { conversation: otherConversation } = await createConversation({ businessId: otherBusiness.id, leadName: "Cross Tenant" });

    const results = await repo!.search(fixture.businessId, {});

    expect(results.map((r) => r.id)).not.toContain(otherConversation.id);

    // Clean up the cross-tenant fixture this test created directly.
    await db!.conversation.delete({ where: { id: otherConversation.id } });
    await db!.lead.deleteMany({ where: { businessId: otherBusiness.id } });
    await db!.business.delete({ where: { id: otherBusiness.id } });
  });

  it("never returns more than MAX_CONVERSATION_SEARCH_RESULTS, regardless of what's requested", async () => {
    const overflow = MAX_CONVERSATION_SEARCH_RESULTS + 5;
    await db!.conversation.createMany({
      data: Array.from({ length: overflow }, () => ({
        businessId: fixture.businessId,
        leadId: fixture.leadId,
        source: "MANUAL_PASTE" as const,
        lastEntryAt: new Date(),
        lastEntryDirection: "INBOUND" as const,
      })),
    });

    const results = await repo!.search(fixture.businessId, {}, 10_000);

    expect(results.length).toBe(MAX_CONVERSATION_SEARCH_RESULTS);
  });

  it("respects a requested limit lower than the cap", async () => {
    await createConversation();
    await createConversation();
    await createConversation();

    const results = await repo!.search(fixture.businessId, {}, 2);

    expect(results.length).toBe(2);
  });
});
