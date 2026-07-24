// Observer Console v1 — read-only DTOs and the combined read-dependency
// bag. Prisma-free: only imports repository *interfaces*
// (server/persistence/repositories.ts) and other Prisma-free type modules —
// enforced by the import-scan guardrail test (__tests__/read-only-guardrail.test.ts).

import type { DomainEvent } from "../domain-events/types";
import type { ObservationType } from "../intelligence/observation/types";
import type {
  ConversationEntryRepository,
  ConversationSearchRepository,
  DomainEventRepository,
  ObservationRepository,
} from "../persistence/repositories";
import type { DetectorDescriptor } from "./detector-registry";

/**
 * Everything the Observer Console read-model assembly services (§20) need,
 * bundled once — same "bundled once, narrower interfaces consumed
 * structurally" pattern as KoriApplicationDependencies
 * (server/application/composition-root.ts). Each service below declares its
 * own minimal dependency interface; this bag satisfies all of them.
 */
export interface ObserverConsoleReadDependencies {
  domainEvents: DomainEventRepository;
  observations: ObservationRepository;
  conversationEntries: ConversationEntryRepository;
  conversationSearch: ConversationSearchRepository;
}

// --- Conversation timeline ---------------------------------------------------

/**
 * Sanitized ConversationEntry projection. rawPayload is never present —
 * PrismaConversationEntryRepository never selects it out of Postgres in the
 * first place (server/persistence/prisma/prisma-conversation-entry-repository.ts).
 */
export interface ConversationEntryProjectionDTO {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  content: string;
  messageType: string;
  occurredAt: string;
  mediaMimeType?: string;
  mediaFilename?: string;
  mediaCaption?: string;
}

/**
 * `detector` documents the detector *associated with* this ObservationType —
 * never a claim about which specific rule instance fired, and
 * `evidenceExcerpt` is the engine's own persisted Evidence[0].excerpt
 * verbatim (or null when the detector never set one, e.g. CUSTOMER_GHOSTED)
 * — never a recomputed or highlighted "matched" substring. See the Observer
 * Console v1.1 spec's "Rule Provenance" revision.
 */
export interface ObservationTimelineEntryDTO {
  id: string;
  type: ObservationType;
  summary: string;
  evidenceExcerpt: string | null;
  detector: DetectorDescriptor;
  occurredAt: string;
}

export interface DomainEventTimelineEntryDTO {
  id: string;
  eventType: DomainEvent["type"];
  occurredAt: string;
  /** null for events with no associated entry (CONVERSATION_CREATED, CONVERSATION_CLOSED). */
  conversationEntry: ConversationEntryProjectionDTO | null;
  /** Empty array = this event generated no observations. */
  observations: ObservationTimelineEntryDTO[];
}

/**
 * The full per-conversation view. Assembled in two parts, deliberately:
 * `events` comes from buildConversationTimeline (pure read-model over
 * repositories); the header fields (leadName/leadPhone/channel/status) come
 * from the tenant-scoped access-control lookup
 * (server/application/access-control.ts) — merged into one object by
 * server/application/dto.ts's toConversationTimelineDTO, not by this module.
 */
export interface ConversationTimelineDTO {
  conversationId: string;
  leadName: string;
  leadPhone: string;
  channel: string;
  status: string;
  events: DomainEventTimelineEntryDTO[];
}

// --- Observation catalog -----------------------------------------------------

export interface ObservationCatalogEntryDTO {
  type: ObservationType;
  count: number;
  lastSeenAt: string | null;
}

export interface ObservationCatalogDTO {
  /** Sorted by type — only types with >=1 Observation appear. */
  counts: ObservationCatalogEntryDTO[];
  /** Every ObservationType with zero Observations ever, for this business. */
  neverObserved: ObservationType[];
}

// --- Conversation search ------------------------------------------------------

export interface ConversationListItemDTO {
  id: string;
  leadName: string;
  leadPhone: string;
  status: string;
  lastEntryAt: string;
  observationCount: number;
}
