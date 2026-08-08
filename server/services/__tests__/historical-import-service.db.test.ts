// Gated: proves importHistoricalEntriesIntoConversation's merge/insert/
// recompute logic against real Postgres (sales_os_test) — in particular
// that lastEntryAt/lastEntryDirection are recomputed from the TRUE max
// across the whole entry set, not overwritten by whatever batch was just
// inserted, and that re-importing the identical batch is a full no-op.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importHistoricalEntriesIntoConversation, type HistoricalImportEntryInput } from "../historical-import-service";
import {
  cleanupTestFixture,
  createTestFixture,
  getTestPrisma,
  shouldRunDbTests,
  type TestFixture,
} from "../../persistence/__tests__/test-db";

function entry(overrides: Partial<HistoricalImportEntryInput> = {}): HistoricalImportEntryInput {
  return {
    direction: "INBOUND",
    content: "Hola, quisiera saber el precio",
    occurredAt: new Date("2026-07-27T14:05:00.000Z"),
    sequenceIndex: 0,
    rawLine: "27/07/26, 14:05 - Juan Pérez: Hola, quisiera saber el precio",
    ...overrides,
  };
}

describe.skipIf(!shouldRunDbTests)("importHistoricalEntriesIntoConversation (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: TestFixture;
  let leadId: string;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "historical-import");
    const lead = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Historical Lead", phone: "+10000000099" } });
    leadId = lead.id;
  });

  afterEach(async () => {
    await db!.conversationEntry.deleteMany({ where: { conversation: { leadId } } });
    await db!.conversation.deleteMany({ where: { leadId } });
    await db!.lead.delete({ where: { id: leadId } });
    await cleanupTestFixture(db!, fixture);
  });

  it("creates a Conversation (source HISTORICAL_IMPORT) and entries from an empty starting point", async () => {
    const entries = [
      entry({ occurredAt: new Date("2026-07-27T14:05:00.000Z"), direction: "INBOUND", content: "Hola, quisiera saber el precio", sequenceIndex: 0 }),
      entry({ occurredAt: new Date("2026-07-27T14:07:00.000Z"), direction: "OUTBOUND", content: "¡Hola! Claro, ¿qué producto te interesa?", sequenceIndex: 1 }),
    ];

    const result = await importHistoricalEntriesIntoConversation(fixture.businessId, leadId, entries, fixture.userId, db);

    expect(result.conversationCreated).toBe(true);
    expect(result.createdCount).toBe(2);
    expect(result.duplicateCount).toBe(0);

    const conversation = await db!.conversation.findUniqueOrThrow({ where: { id: result.conversationId! } });
    expect(conversation.source).toBe("HISTORICAL_IMPORT");
    expect(conversation.lastEntryAt.toISOString()).toBe("2026-07-27T14:07:00.000Z");
    expect(conversation.lastEntryDirection).toBe("OUTBOUND");
    expect(conversation.status).toBe("WAITING_ON_CUSTOMER");

    const storedEntries = await db!.conversationEntry.findMany({ where: { conversationId: result.conversationId! } });
    expect(storedEntries).toHaveLength(2);
    expect(storedEntries.every((e) => e.externalId?.startsWith("import:sha256:"))).toBe(true);
    expect(storedEntries.every((e) => (e.rawPayload as { imported?: boolean })?.imported === true)).toBe(true);
  });

  it("re-importing the identical batch is a full no-op", async () => {
    const entries = [entry()];
    const first = await importHistoricalEntriesIntoConversation(fixture.businessId, leadId, entries, fixture.userId, db);
    expect(first.createdCount).toBe(1);

    const second = await importHistoricalEntriesIntoConversation(fixture.businessId, leadId, entries, fixture.userId, db);
    expect(second.createdCount).toBe(0);
    expect(second.duplicateCount).toBe(1);
    expect(second.conversationCreated).toBe(false);
    expect(second.conversationId).toBe(first.conversationId);

    const storedEntries = await db!.conversationEntry.findMany({ where: { conversationId: first.conversationId! } });
    expect(storedEntries).toHaveLength(1);
  });

  it("merging older historical entries into a conversation with newer live entries leaves lastEntryAt/source reflecting the live data", async () => {
    // Simulate a live WHATSAPP_SYNCED conversation that already has a newer entry.
    const liveConversation = await db!.conversation.create({
      data: {
        businessId: fixture.businessId,
        leadId,
        channel: "WHATSAPP",
        source: "WHATSAPP_SYNCED",
        status: "NEEDS_REPLY",
        lastEntryAt: new Date("2026-08-01T10:00:00.000Z"),
        lastEntryDirection: "INBOUND",
        createdByUserId: null,
      },
    });
    await db!.conversationEntry.create({
      data: {
        conversationId: liveConversation.id,
        direction: "INBOUND",
        content: "Mensaje en vivo",
        occurredAt: new Date("2026-08-01T10:00:00.000Z"),
        externalId: "wamid.LIVE-1",
      },
    });

    const historicalEntries = [entry({ occurredAt: new Date("2026-07-27T14:05:00.000Z"), direction: "INBOUND" })];
    const result = await importHistoricalEntriesIntoConversation(fixture.businessId, leadId, historicalEntries, fixture.userId, db);

    expect(result.conversationCreated).toBe(false);
    expect(result.conversationId).toBe(liveConversation.id);
    expect(result.createdCount).toBe(1);

    const conversation = await db!.conversation.findUniqueOrThrow({ where: { id: liveConversation.id } });
    // lastEntryAt still reflects the LIVE (newer) entry, not the older historical one just inserted.
    expect(conversation.lastEntryAt.toISOString()).toBe("2026-08-01T10:00:00.000Z");
    // source is provenance-of-origin, never overwritten by a later merge.
    expect(conversation.source).toBe("WHATSAPP_SYNCED");

    const allEntries = await db!.conversationEntry.findMany({ where: { conversationId: liveConversation.id } });
    expect(allEntries).toHaveLength(2);
  });

  it("merging historical entries newer than existing live entries correctly advances lastEntryAt", async () => {
    const liveConversation = await db!.conversation.create({
      data: {
        businessId: fixture.businessId,
        leadId,
        channel: "WHATSAPP",
        source: "WHATSAPP_SYNCED",
        status: "NEEDS_REPLY",
        lastEntryAt: new Date("2026-01-01T00:00:00.000Z"),
        lastEntryDirection: "INBOUND",
        createdByUserId: null,
      },
    });
    await db!.conversationEntry.create({
      data: {
        conversationId: liveConversation.id,
        direction: "INBOUND",
        content: "Mensaje viejo",
        occurredAt: new Date("2026-01-01T00:00:00.000Z"),
        externalId: "wamid.LIVE-OLD",
      },
    });

    const historicalEntries = [entry({ occurredAt: new Date("2026-08-01T09:00:00.000Z"), direction: "OUTBOUND" })];
    const result = await importHistoricalEntriesIntoConversation(fixture.businessId, leadId, historicalEntries, fixture.userId, db);

    const conversation = await db!.conversation.findUniqueOrThrow({ where: { id: result.conversationId! } });
    expect(conversation.lastEntryAt.toISOString()).toBe("2026-08-01T09:00:00.000Z");
    expect(conversation.lastEntryDirection).toBe("OUTBOUND");
    expect(conversation.status).toBe("WAITING_ON_CUSTOMER");
  });

  it("an empty entries array never creates a conversation", async () => {
    const result = await importHistoricalEntriesIntoConversation(fixture.businessId, leadId, [], fixture.userId, db);
    expect(result.conversationCreated).toBe(false);
    expect(result.conversationId).toBeNull();
    expect(result.createdCount).toBe(0);

    const conversations = await db!.conversation.findMany({ where: { leadId } });
    expect(conversations).toHaveLength(0);
  });
});
