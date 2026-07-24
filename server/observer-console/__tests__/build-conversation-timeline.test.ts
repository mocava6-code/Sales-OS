import { describe, expect, it } from "vitest";
import type { MessageReceivedEvent } from "../../domain-events/types";
import type { ConversationEntryRecord, SavedDomainEventRecord, SavedObservationRecord } from "../../persistence/types";
import { buildConversationTimeline } from "../build-conversation-timeline";
import {
  createFakeConversationEntryRepository,
  createFakeDomainEventRepository,
  createFakeObservationRepository,
} from "./fakes";

const CONVERSATION_ID = "conv-1";

function domainEvent(overrides: Partial<SavedDomainEventRecord> = {}): SavedDomainEventRecord {
  const event: MessageReceivedEvent = {
    type: "MESSAGE_RECEIVED",
    businessId: "biz-1",
    conversationId: CONVERSATION_ID,
    conversationEntryId: "entry-1",
    messageType: "TEXT",
    content: "hola",
    occurredAt: new Date("2026-07-20T12:00:00Z"),
  };
  return {
    id: "event-1",
    businessId: "biz-1",
    conversationId: CONVERSATION_ID,
    conversationEntryId: "entry-1",
    eventType: "MESSAGE_RECEIVED",
    event,
    occurredAt: new Date("2026-07-20T12:00:00Z"),
    createdAt: new Date("2026-07-20T12:00:00Z"),
    ...overrides,
  };
}

function observation(overrides: Partial<SavedObservationRecord> = {}): SavedObservationRecord {
  return {
    id: "obs-1",
    businessId: "biz-1",
    conversationId: CONVERSATION_ID,
    domainEventId: "event-1",
    conversationEntryId: "entry-1",
    observation: {
      type: "PRICE_REQUEST",
      summary: "Customer asked about price.",
      evidence: [{ sourceType: "conversation_message", sourceId: "entry-1", excerpt: "cuánto cuesta?" }],
    },
    occurredAt: new Date("2026-07-20T12:00:00Z"),
    createdAt: new Date("2026-07-20T12:00:00Z"),
    ...overrides,
  };
}

function entry(overrides: Partial<ConversationEntryRecord> = {}): ConversationEntryRecord {
  return {
    id: "entry-1",
    direction: "INBOUND",
    content: "cuánto cuesta?",
    messageType: "TEXT",
    occurredAt: new Date("2026-07-20T12:00:00Z"),
    mediaMimeType: null,
    mediaFilename: null,
    mediaCaption: null,
    ...overrides,
  };
}

describe("buildConversationTimeline", () => {
  it("attaches the matching ConversationEntry projection to its event, excluding rawPayload-adjacent fields", async () => {
    const dependencies = {
      domainEvents: createFakeDomainEventRepository([domainEvent()]),
      observations: createFakeObservationRepository([]),
      conversationEntries: createFakeConversationEntryRepository([entry()]),
    };

    const [result] = await buildConversationTimeline(CONVERSATION_ID, dependencies);

    expect(result.conversationEntry).toEqual({
      id: "entry-1",
      direction: "INBOUND",
      content: "cuánto cuesta?",
      messageType: "TEXT",
      occurredAt: "2026-07-20T12:00:00.000Z",
      mediaMimeType: undefined,
      mediaFilename: undefined,
      mediaCaption: undefined,
    });
    expect(result).not.toHaveProperty("rawPayload");
  });

  it("returns an empty observations array for an event with none", async () => {
    const dependencies = {
      domainEvents: createFakeDomainEventRepository([domainEvent()]),
      observations: createFakeObservationRepository([]),
      conversationEntries: createFakeConversationEntryRepository([entry()]),
    };

    const [result] = await buildConversationTimeline(CONVERSATION_ID, dependencies);

    expect(result.observations).toEqual([]);
  });

  it("nests matching observations under their DomainEvent, with detector metadata and verbatim evidence excerpt", async () => {
    const dependencies = {
      domainEvents: createFakeDomainEventRepository([domainEvent()]),
      observations: createFakeObservationRepository([observation()]),
      conversationEntries: createFakeConversationEntryRepository([entry()]),
    };

    const [result] = await buildConversationTimeline(CONVERSATION_ID, dependencies);

    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({
      type: "PRICE_REQUEST",
      summary: "Customer asked about price.",
      evidenceExcerpt: "cuánto cuesta?",
      detector: { detectorId: "keyword.price_request", kind: "keyword" },
    });
  });

  it("evidenceExcerpt is null when the observation carries no excerpt (e.g. CUSTOMER_GHOSTED)", async () => {
    const ghosted = observation({
      id: "obs-ghosted",
      observation: { type: "CUSTOMER_GHOSTED", summary: "Conversation closed over 24h after...", evidence: [{ sourceType: "conversation_message", sourceId: CONVERSATION_ID }] },
    });
    const dependencies = {
      domainEvents: createFakeDomainEventRepository([domainEvent()]),
      observations: createFakeObservationRepository([ghosted]),
      conversationEntries: createFakeConversationEntryRepository([entry()]),
    };

    const [result] = await buildConversationTimeline(CONVERSATION_ID, dependencies);

    expect(result.observations[0].evidenceExcerpt).toBeNull();
  });

  it("conversationEntry is null for conversation-level events (no conversationEntryId)", async () => {
    const created = domainEvent({
      id: "event-created",
      conversationEntryId: null,
      eventType: "CONVERSATION_CREATED",
      event: {
        type: "CONVERSATION_CREATED",
        businessId: "biz-1",
        conversationId: CONVERSATION_ID,
        leadId: "lead-1",
        channel: "WHATSAPP",
        source: "WHATSAPP_SYNCED",
        occurredAt: new Date("2026-07-20T11:00:00Z"),
      },
      occurredAt: new Date("2026-07-20T11:00:00Z"),
    });
    const dependencies = {
      domainEvents: createFakeDomainEventRepository([created]),
      observations: createFakeObservationRepository([]),
      conversationEntries: createFakeConversationEntryRepository([]),
    };

    const [result] = await buildConversationTimeline(CONVERSATION_ID, dependencies);

    expect(result.conversationEntry).toBeNull();
  });

  it("orders events by occurredAt asc, then id asc when timestamps tie", async () => {
    const tiedOccurredAt = new Date("2026-07-20T12:00:00Z");
    const eventB = domainEvent({ id: "event-b", conversationEntryId: "entry-b", occurredAt: tiedOccurredAt });
    const eventA = domainEvent({ id: "event-a", conversationEntryId: "entry-a", occurredAt: tiedOccurredAt });
    const dependencies = {
      // Constructed out of order on purpose — the function must not rely on input order.
      domainEvents: createFakeDomainEventRepository([eventB, eventA]),
      observations: createFakeObservationRepository([]),
      conversationEntries: createFakeConversationEntryRepository([]),
    };

    const results = await buildConversationTimeline(CONVERSATION_ID, dependencies);

    expect(results.map((r) => r.id)).toEqual(["event-a", "event-b"]);
  });

  it("orders observations nested under one event by occurredAt asc, then id asc when timestamps tie", async () => {
    const tiedOccurredAt = new Date("2026-07-20T12:00:00Z");
    const obsB = observation({ id: "obs-b", occurredAt: tiedOccurredAt, observation: { type: "DISCOUNT_NEGOTIATION", summary: "s", evidence: [] } });
    const obsA = observation({ id: "obs-a", occurredAt: tiedOccurredAt, observation: { type: "PRICE_REQUEST", summary: "s", evidence: [] } });
    const dependencies = {
      domainEvents: createFakeDomainEventRepository([domainEvent({ occurredAt: tiedOccurredAt })]),
      // Constructed out of order on purpose.
      observations: createFakeObservationRepository([obsB, obsA]),
      conversationEntries: createFakeConversationEntryRepository([entry()]),
    };

    const [result] = await buildConversationTimeline(CONVERSATION_ID, dependencies);

    expect(result.observations.map((o) => o.id)).toEqual(["obs-a", "obs-b"]);
  });
});
