// Kori's memory — persistence-layer domain contracts (Phase D).
//
// This module is Prisma-free by design: it re-exports/wraps the Decision
// Engine's and Conversation Intelligence Engine's own domain objects
// (KoriDecision, ConversationIntelligenceResult) rather than reinventing
// parallel types for them — those engines already emit exactly what needs
// to be persisted. Only genuinely new concepts introduced by this phase
// (DecisionEvent, AdvisorAction, Outcome) get new types here.

import type { DomainEvent } from "../domain-events/types";
import type { ConversationIntelligenceResult } from "../intelligence/types";
import type { DecisionStatus, KoriDecision } from "../intelligence/decision/types";
import type { Observation, ObservationType } from "../intelligence/observation/types";

// --- ConversationSnapshot ---------------------------------------------------

export interface SaveConversationSnapshotInput {
  businessId: string;
  conversationId: string;
  result: ConversationIntelligenceResult;
}

export interface SavedConversationSnapshot {
  id: string;
  businessId: string;
  conversationId: string;
  /** Reassembled verbatim from storage — identical in shape to what the engine produced. */
  result: ConversationIntelligenceResult;
  createdAt: Date;
}

// --- DecisionRecord ----------------------------------------------------------

export interface SaveDecisionInput {
  businessId: string;
  /** Which persisted ConversationSnapshot informed this decision, if any (see KoriDecisionContext.conversationIntelligence). */
  conversationSnapshotId?: string;
  decision: KoriDecision;
}

export interface SavedDecisionRecord {
  id: string;
  businessId: string;
  conversationId: string;
  conversationSnapshotId: string | null;
  /** Reassembled verbatim from storage — identical in shape to what the engine produced. */
  decision: KoriDecision;
  createdAt: Date;
}

// --- DecisionEvent (append-only) ----------------------------------------------

/**
 * Almost a strict superset of DecisionStatus (see
 * server/intelligence/decision/types.ts) so most status transitions can also
 * be recorded as an event, plus downstream commercial-lifecycle events that
 * have no corresponding status — except OVERRIDDEN, deliberately excluded:
 * recordAdvisorOverride always fires the more specific ADVISOR_OVERRIDDEN
 * instead of a bare "OVERRIDDEN" event (see the DB schema's DecisionEventType
 * enum comment for the full rationale).
 */
export type DecisionEventType =
  | Exclude<DecisionStatus, "OVERRIDDEN">
  | "CUSTOMER_REPLIED"
  | "FOLLOW_UP_SENT"
  | "SALE_CLOSED"
  | "SALE_LOST"
  | "ADVISOR_OVERRIDDEN"
  | "KORI_OVERRIDDEN";

export interface AppendDecisionEventInput {
  decisionRecordId: string;
  eventType: DecisionEventType;
  /** Defaults to now() if omitted. */
  occurredAt?: Date;
  note?: string;
}

export interface DecisionEventRecord {
  id: string;
  decisionRecordId: string;
  eventType: DecisionEventType;
  occurredAt: Date;
  note: string | null;
  createdAt: Date;
}

// --- AdvisorAction (append-only) ----------------------------------------------

export type AdvisorActionType =
  | "FOLLOWED_RECOMMENDATION"
  | "IGNORED_RECOMMENDATION"
  | "PARTIALLY_FOLLOWED_RECOMMENDATION"
  | "CUSTOM_ACTION";

export interface RecordAdvisorActionInput {
  decisionRecordId: string;
  actionType: AdvisorActionType;
  advisorUserId?: string;
  notes?: string;
  occurredAt?: Date;
}

export interface AdvisorActionRecord {
  id: string;
  decisionRecordId: string;
  actionType: AdvisorActionType;
  advisorUserId: string | null;
  notes: string | null;
  occurredAt: Date;
  createdAt: Date;
}

// --- Outcome (append-only) ----------------------------------------------------

export type OutcomeType =
  | "CUSTOMER_REPLIED"
  | "MEETING_SCHEDULED"
  | "FOLLOW_UP_SENT"
  | "QUOTATION_REQUESTED"
  | "QUOTATION_SENT"
  | "SALE_CLOSED"
  | "SALE_LOST"
  | "ABANDONED";

/**
 * What actually produced the outcome. Required for SALE_CLOSED/SALE_LOST,
 * optional otherwise — the requirement is enforced at the orchestration
 * boundary (server/orchestration/outcome-attribution-policy.ts), not here;
 * this layer just persists whatever it's given.
 */
export type OutcomeAttribution = "KORI_RECOMMENDATION" | "ADVISOR_ALTERNATIVE" | "UNATTRIBUTED";

export interface RecordOutcomeInput {
  decisionRecordId: string;
  outcomeType: OutcomeType;
  attribution?: OutcomeAttribution;
  notes?: string;
  occurredAt?: Date;
}

export interface OutcomeRecord {
  id: string;
  decisionRecordId: string;
  outcomeType: OutcomeType;
  attribution: OutcomeAttribution | null;
  notes: string | null;
  occurredAt: Date;
  createdAt: Date;
}

// --- Observer Mode v1: DomainEvent (append-only) ------------------------------

export interface SaveDomainEventInput {
  businessId: string;
  conversationId: string;
  conversationEntryId?: string;
  /** The full event object, persisted verbatim (payload column) — reprocessable. */
  event: DomainEvent;
}

export interface SavedDomainEventRecord {
  id: string;
  businessId: string;
  conversationId: string;
  conversationEntryId: string | null;
  eventType: DomainEvent["type"];
  /** Reassembled verbatim from storage — identical in shape to what was recorded. */
  event: DomainEvent;
  occurredAt: Date;
  createdAt: Date;
}

// --- Observer Mode v1: Observation (append-only) ------------------------------

export interface SaveObservationInput {
  businessId: string;
  conversationId: string;
  domainEventId: string;
  conversationEntryId?: string;
  observation: Observation;
  occurredAt: Date;
}

export interface SavedObservationRecord {
  id: string;
  businessId: string;
  conversationId: string;
  domainEventId: string;
  conversationEntryId: string | null;
  /** Reassembled verbatim from storage — identical in shape to what the engine produced. */
  observation: Observation;
  occurredAt: Date;
  createdAt: Date;
}

// --- Observer Console v1: read-only aggregate/search/projection contracts ----
//
// Every type in this section backs a read-only repository method consumed
// by server/observer-console/** (see ARCHITECTURE.md §20). None of them are
// used by KoriUnitOfWork/TransactionRunner — there is no write/atomicity
// concern here, only reads.

/**
 * One row per ObservationType that has >=1 saved Observation for a business
 * — types with zero rows are absent, not zero-filled. The caller computes
 * "never observed" as a set difference against the full ObservationType
 * enum (server/observer-console/observation-catalog.ts).
 */
export interface ObservationTypeAggregate {
  type: ObservationType;
  count: number;
  lastSeenAt: Date | null;
}

/** Hard ceiling for ConversationSearchRepository.search — enforced inside the implementation, never left to the caller to self-limit. */
export const MAX_CONVERSATION_SEARCH_RESULTS = 50;

/**
 * "ANY" (default) applies no observation-presence filter. HAS_ANY/HAS_NONE
 * are mutually exclusive with `hasObservationType` — HAS_NONE combined with
 * a specific type is a contradiction ("conversations with no observations
 * that have this observation type") and is rejected at the application
 * validation layer (server/application/observer-console-actions.ts), not
 * silently reinterpreted here.
 */
export type ObservationStateFilter = "ANY" | "HAS_ANY" | "HAS_NONE";

export interface ConversationSearchFilters {
  /** Matched against Lead.name / Lead.phone, case-insensitive. */
  searchText?: string;
  occurredAfter?: Date;
  occurredBefore?: Date;
  hasObservationType?: ObservationType;
  observationState?: ObservationStateFilter;
}

export interface ConversationListItem {
  id: string;
  leadName: string;
  leadPhone: string;
  status: string;
  lastEntryAt: Date;
  observationCount: number;
}

/**
 * Sanitized ConversationEntry projection — rawPayload (and mediaId/
 * mediaSizeBytes/quotedExternalId/externalId) are deliberately absent.
 * PrismaConversationEntryRepository excludes them at the query's `select`
 * level, not by filtering an already-fetched row, so rawPayload never
 * leaves Postgres for this read path.
 */
export interface ConversationEntryRecord {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  content: string;
  messageType: string;
  occurredAt: Date;
  mediaMimeType: string | null;
  mediaFilename: string | null;
  mediaCaption: string | null;
}
