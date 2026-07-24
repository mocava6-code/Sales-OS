import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MessageReceivedEvent } from "../../domain-events/types";
import { PrismaDomainEventRepository } from "../prisma/prisma-domain-event-repository";
import { cleanupTestFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "./test-db";

describe.skipIf(!shouldRunDbTests)("PrismaDomainEventRepository (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  const repo = db ? new PrismaDomainEventRepository(db) : undefined;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "domain-event");
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
  });

  function messageReceived(overrides: Partial<MessageReceivedEvent> = {}): MessageReceivedEvent {
    return {
      type: "MESSAGE_RECEIVED",
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      conversationEntryId: "entry-1",
      messageType: "TEXT",
      content: "hola",
      occurredAt: new Date("2026-07-20T12:00:00.000Z"),
      ...overrides,
    };
  }

  it("appends an event and lists it back, verbatim", async () => {
    const event = messageReceived({ content: "cuánto cuesta?" });
    const saved = await repo!.append({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      conversationEntryId: "entry-1",
      event,
    });

    expect(saved.id).toBeTruthy();
    expect(saved.eventType).toBe("MESSAGE_RECEIVED");
    expect(saved.conversationEntryId).toBe("entry-1");
    expect(saved.event).toEqual(event);

    const history = await repo!.listForConversation(fixture.conversationId);
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(saved.id);
  });

  it("is append-only and chronological across multiple events, never aggregated", async () => {
    await repo!.append({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      event: messageReceived({ occurredAt: new Date("2026-07-20T12:00:00.000Z") }),
    });
    await repo!.append({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      event: {
        type: "CONVERSATION_CLOSED",
        businessId: fixture.businessId,
        conversationId: fixture.conversationId,
        lastEntryDirection: "OUTBOUND",
        lastEntryAt: new Date("2026-07-20T13:00:00.000Z"),
        occurredAt: new Date("2026-07-21T09:00:00.000Z"),
      },
    });

    const history = await repo!.listForConversation(fixture.conversationId);

    expect(history.map((e) => e.eventType)).toEqual(["MESSAGE_RECEIVED", "CONVERSATION_CLOSED"]);
  });

  it("breaks ties on occurredAt by id asc, deterministically — never insertion order or physical storage order", async () => {
    const tiedOccurredAt = new Date("2026-07-20T12:00:00.000Z");
    const first = await repo!.append({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      event: messageReceived({ occurredAt: tiedOccurredAt, content: "first" }),
    });
    const second = await repo!.append({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      event: messageReceived({ occurredAt: tiedOccurredAt, content: "second" }),
    });

    const history = await repo!.listForConversation(fixture.conversationId);
    const expectedOrder = [first.id, second.id].sort();

    expect(history.map((e) => e.id)).toEqual(expectedOrder);
  });

  it("preserves a null conversationEntryId for conversation-level events", async () => {
    const saved = await repo!.append({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      event: {
        type: "CONVERSATION_CREATED",
        businessId: fixture.businessId,
        conversationId: fixture.conversationId,
        leadId: fixture.leadId,
        channel: "WHATSAPP",
        source: "WHATSAPP_SYNCED",
        occurredAt: new Date(),
      },
    });

    expect(saved.conversationEntryId).toBeNull();
  });
});
