import { describe, expect, it, vi } from "vitest";
import type { ConversationEntryRecord, SavedDomainEventRecord } from "../../persistence/types";
import {
  createFakeConversationEntryRepository,
  createFakeConversationSearchRepository,
  createFakeDomainEventRepository,
  createFakeObservationRepository,
} from "../../observer-console/__tests__/fakes";
import type { AuthorizedConversationForObserverConsole } from "../access-control";
import { NotFoundError } from "../errors";
import {
  getConversationTimelineHandler,
  getObservationCatalogHandler,
  searchConversationsHandler,
} from "../observer-console-actions";
import { createFakeAuthContextResolver } from "../testing/fake-auth";

const owner = { id: "user-owner", businessId: "biz-1", role: "OWNER" as const };
const advisor = { id: "user-advisor", businessId: "biz-1", role: "SALESPERSON" as const };

const header: AuthorizedConversationForObserverConsole = {
  id: "conv-1",
  businessId: "biz-1",
  leadName: "Maria Gonzalez",
  leadPhone: "+525512345678",
  channel: "WHATSAPP",
  status: "NEEDS_REPLY",
};

function emptyReadDependencies() {
  return {
    domainEvents: createFakeDomainEventRepository([]),
    observations: createFakeObservationRepository([]),
    conversationEntries: createFakeConversationEntryRepository([]),
    conversationSearch: createFakeConversationSearchRepository([]),
  };
}

describe("getConversationTimelineHandler", () => {
  it("returns UNAUTHENTICATED and never loads the conversation when signed out", async () => {
    const loadConversation = vi.fn();
    const result = await getConversationTimelineHandler(
      { conversationId: "conv-1" },
      { resolver: createFakeAuthContextResolver(null), loadConversation, readDependencies: emptyReadDependencies() },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHENTICATED");
    expect(loadConversation).not.toHaveBeenCalled();
  });

  it("returns FORBIDDEN for a SALESPERSON, checked before loading the conversation", async () => {
    const loadConversation = vi.fn();
    const result = await getConversationTimelineHandler(
      { conversationId: "conv-1" },
      { resolver: createFakeAuthContextResolver(advisor), loadConversation, readDependencies: emptyReadDependencies() },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
    expect(loadConversation).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for a cross-tenant conversationId, for an OWNER", async () => {
    const loadConversation = vi.fn(async () => {
      throw new NotFoundError("Conversation");
    });
    const result = await getConversationTimelineHandler(
      { conversationId: "conv-other-tenant" },
      { resolver: createFakeAuthContextResolver(owner), loadConversation, readDependencies: emptyReadDependencies() },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("returns INVALID_INPUT for a missing conversationId", async () => {
    const result = await getConversationTimelineHandler(
      {},
      { resolver: createFakeAuthContextResolver(owner), readDependencies: emptyReadDependencies() },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("assembles the full timeline DTO from the header and the read model, for an OWNER", async () => {
    const event: SavedDomainEventRecord = {
      id: "event-1",
      businessId: "biz-1",
      conversationId: "conv-1",
      conversationEntryId: "entry-1",
      eventType: "MESSAGE_RECEIVED",
      event: {
        type: "MESSAGE_RECEIVED",
        businessId: "biz-1",
        conversationId: "conv-1",
        conversationEntryId: "entry-1",
        messageType: "TEXT",
        content: "hola",
        occurredAt: new Date("2026-07-20T12:00:00Z"),
      },
      occurredAt: new Date("2026-07-20T12:00:00Z"),
      createdAt: new Date("2026-07-20T12:00:00Z"),
    };
    const entry: ConversationEntryRecord = {
      id: "entry-1",
      direction: "INBOUND",
      content: "hola",
      messageType: "TEXT",
      occurredAt: new Date("2026-07-20T12:00:00Z"),
      mediaMimeType: null,
      mediaFilename: null,
      mediaCaption: null,
    };

    const result = await getConversationTimelineHandler(
      { conversationId: "conv-1" },
      {
        resolver: createFakeAuthContextResolver(owner),
        loadConversation: async () => header,
        readDependencies: {
          domainEvents: createFakeDomainEventRepository([event]),
          observations: createFakeObservationRepository([]),
          conversationEntries: createFakeConversationEntryRepository([entry]),
          conversationSearch: createFakeConversationSearchRepository([]),
        },
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.conversationId).toBe("conv-1");
      expect(result.data.leadName).toBe("Maria Gonzalez");
      expect(result.data.events).toHaveLength(1);
      expect(result.data.events[0].conversationEntry?.content).toBe("hola");
    }
  });
});

describe("getObservationCatalogHandler", () => {
  it("returns FORBIDDEN for a SALESPERSON", async () => {
    const result = await getObservationCatalogHandler({
      resolver: createFakeAuthContextResolver(advisor),
      readDependencies: emptyReadDependencies(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
  });

  it("returns the catalog for an OWNER", async () => {
    const result = await getObservationCatalogHandler({
      resolver: createFakeAuthContextResolver(owner),
      readDependencies: {
        ...emptyReadDependencies(),
        observations: createFakeObservationRepository([], [
          { type: "PRICE_REQUEST", count: 2, lastSeenAt: new Date("2026-07-24T09:00:00Z") },
        ]),
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.counts).toEqual([{ type: "PRICE_REQUEST", count: 2, lastSeenAt: "2026-07-24T09:00:00.000Z" }]);
      expect(result.data.neverObserved).not.toContain("PRICE_REQUEST");
    }
  });
});

describe("searchConversationsHandler", () => {
  it("returns FORBIDDEN for a SALESPERSON", async () => {
    const result = await searchConversationsHandler(
      {},
      { resolver: createFakeAuthContextResolver(advisor), readDependencies: emptyReadDependencies() },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
  });

  it("rejects HAS_NONE combined with hasObservationType as INVALID_INPUT", async () => {
    const result = await searchConversationsHandler(
      { observationState: "HAS_NONE", hasObservationType: "PRICE_REQUEST" },
      { resolver: createFakeAuthContextResolver(owner), readDependencies: emptyReadDependencies() },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("accepts HAS_ANY combined with hasObservationType (redundant, not contradictory)", async () => {
    const result = await searchConversationsHandler(
      { observationState: "HAS_ANY", hasObservationType: "PRICE_REQUEST" },
      { resolver: createFakeAuthContextResolver(owner), readDependencies: emptyReadDependencies() },
    );

    expect(result.ok).toBe(true);
  });

  it("returns mapped results for a valid search, for an OWNER", async () => {
    const result = await searchConversationsHandler(
      { searchText: "maria" },
      {
        resolver: createFakeAuthContextResolver(owner),
        readDependencies: {
          ...emptyReadDependencies(),
          conversationSearch: createFakeConversationSearchRepository([
            {
              id: "conv-1",
              leadName: "Maria Gonzalez",
              leadPhone: "+525512345678",
              status: "NEEDS_REPLY",
              lastEntryAt: new Date("2026-07-24T09:00:00Z"),
              observationCount: 1,
            },
          ]),
        },
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([
        {
          id: "conv-1",
          leadName: "Maria Gonzalez",
          leadPhone: "+525512345678",
          status: "NEEDS_REPLY",
          lastEntryAt: "2026-07-24T09:00:00.000Z",
          observationCount: 1,
        },
      ]);
    }
  });
});
