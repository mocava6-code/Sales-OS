// Repository interfaces — the only persistence boundary the rest of the
// codebase should ever depend on. Prisma-free: nothing here imports
// @/server/db/client or any generated Prisma type. The Decision Engine and
// Conversation Intelligence Engine (server/intelligence/**) never import
// from this module or from ./prisma — they only ever emit KoriDecision /
// ConversationIntelligenceResult domain objects; whatever calls the engine
// is responsible for handing the result to a repository.
//
// Repositories are intentionally thin: no business logic, no orchestration
// between methods (e.g. `save`ing a decision never implicitly appends a
// DecisionEvent — that's a future caller's decision, not this layer's).

import type {
  AdvisorActionRecord,
  AppendDecisionEventInput,
  ConversationEntryRecord,
  ConversationListItem,
  ConversationSearchFilters,
  DecisionEventRecord,
  ObservationTypeAggregate,
  OutcomeRecord,
  RecordAdvisorActionInput,
  RecordOutcomeInput,
  SaveConversationSnapshotInput,
  SaveDecisionInput,
  SaveDomainEventInput,
  SaveObservationInput,
  SavedConversationSnapshot,
  SavedDecisionRecord,
  SavedDomainEventRecord,
  SavedObservationRecord,
} from "./types";
import type { DecisionStatus } from "../intelligence/decision/types";

/** Append-only: no update or delete method exists on this interface by design. */
export interface ConversationSnapshotRepository {
  save(input: SaveConversationSnapshotInput): Promise<SavedConversationSnapshot>;
  findLatestForConversation(conversationId: string): Promise<SavedConversationSnapshot | null>;
  /** Chronological, oldest first — the full history of what Kori knew about this conversation over time. */
  listForConversation(conversationId: string): Promise<SavedConversationSnapshot[]>;
}

export interface DecisionRepository {
  save(input: SaveDecisionInput): Promise<SavedDecisionRecord>;
  findById(id: string): Promise<SavedDecisionRecord | null>;
  /** Chronological, oldest first. */
  listForConversation(conversationId: string): Promise<SavedDecisionRecord[]>;
  /**
   * The one sanctioned mutation in this entire persistence layer — updates
   * only the fast-query `status` field. Does not append a DecisionEvent;
   * callers that want a full audit trail must also call
   * DecisionEventRepository.append separately.
   */
  updateStatus(id: string, status: DecisionStatus): Promise<SavedDecisionRecord>;
}

/** Append-only: no update or delete method exists on this interface by design. */
export interface DecisionEventRepository {
  append(input: AppendDecisionEventInput): Promise<DecisionEventRecord>;
  /** Chronological, oldest first — never aggregated. */
  listForDecision(decisionRecordId: string): Promise<DecisionEventRecord[]>;
}

/** Append-only: no update or delete method exists on this interface by design. */
export interface AdvisorActionRepository {
  record(input: RecordAdvisorActionInput): Promise<AdvisorActionRecord>;
  /** Chronological, oldest first. */
  listForDecision(decisionRecordId: string): Promise<AdvisorActionRecord[]>;
}

/** Append-only: no update or delete method exists on this interface by design. */
export interface OutcomeRepository {
  record(input: RecordOutcomeInput): Promise<OutcomeRecord>;
  /** Chronological, oldest first. */
  listForDecision(decisionRecordId: string): Promise<OutcomeRecord[]>;
}

/** Append-only: no update or delete method exists on this interface by design. */
export interface DomainEventRepository {
  append(input: SaveDomainEventInput): Promise<SavedDomainEventRecord>;
  /** Chronological, oldest first. */
  listForConversation(conversationId: string): Promise<SavedDomainEventRecord[]>;
}

/** Append-only: no update or delete method exists on this interface by design. */
export interface ObservationRepository {
  save(input: SaveObservationInput): Promise<SavedObservationRecord>;
  /** Chronological — occurredAt asc, then id asc as a tie-break for deterministic ordering. */
  listForConversation(conversationId: string): Promise<SavedObservationRecord[]>;
  /** Read-only aggregate for Observer Console's catalog view (ARCHITECTURE.md §20) — never used by KoriUnitOfWork. */
  aggregateByType(businessId: string): Promise<ObservationTypeAggregate[]>;
}

// --- Observer Console v1: read-only, never added to KoriUnitOfWork ----------
//
// Neither repository below participates in a transaction — both are pure
// reads with no atomicity requirement, consumed only by
// server/observer-console/** (ARCHITECTURE.md §20).

export interface ConversationSearchRepository {
  /**
   * Always capped at MAX_CONVERSATION_SEARCH_RESULTS regardless of what's
   * requested — enforced inside the implementation via Math.min, never
   * left to the caller to self-limit. Ordered lastEntryAt desc (most
   * recently active conversation first).
   */
  search(businessId: string, filters: ConversationSearchFilters, limit?: number): Promise<ConversationListItem[]>;
}

export interface ConversationEntryRepository {
  /**
   * Chronological — occurredAt asc, then id asc. Never selects rawPayload —
   * see ConversationEntryRecord's doc comment in ./types.
   */
  listForConversation(conversationId: string): Promise<ConversationEntryRecord[]>;
}
