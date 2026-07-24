// In-memory fakes for the four read-only repositories Observer Console
// depends on — mirrors server/orchestration/__tests__/fakes.ts's
// conventions. These implement the interfaces directly; they are never the
// Prisma-backed classes, keeping these tests fast and DB-free.

import type {
  ConversationEntryRepository,
  ConversationSearchRepository,
  DomainEventRepository,
  ObservationRepository,
} from "../../persistence/repositories";
import type {
  ConversationEntryRecord,
  ConversationListItem,
  ObservationTypeAggregate,
  SavedDomainEventRecord,
  SavedObservationRecord,
} from "../../persistence/types";

export function createFakeDomainEventRepository(events: SavedDomainEventRecord[]): DomainEventRepository {
  return {
    async append(): Promise<SavedDomainEventRecord> {
      throw new Error("not implemented in this fake — read-only tests never append");
    },
    async listForConversation(conversationId: string) {
      return events.filter((e) => e.conversationId === conversationId);
    },
  };
}

export function createFakeObservationRepository(
  observations: SavedObservationRecord[],
  aggregates: ObservationTypeAggregate[] = [],
): ObservationRepository {
  return {
    async save(): Promise<SavedObservationRecord> {
      throw new Error("not implemented in this fake — read-only tests never save");
    },
    async listForConversation(conversationId: string) {
      return observations.filter((o) => o.conversationId === conversationId);
    },
    async aggregateByType() {
      return aggregates;
    },
  };
}

export function createFakeConversationEntryRepository(entries: ConversationEntryRecord[]): ConversationEntryRepository {
  return {
    async listForConversation() {
      return entries;
    },
  };
}

export function createFakeConversationSearchRepository(results: ConversationListItem[]): ConversationSearchRepository {
  return {
    async search() {
      return results;
    },
  };
}
