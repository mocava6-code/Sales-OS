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
  DecisionEventRecord,
  OutcomeRecord,
  RecordAdvisorActionInput,
  RecordOutcomeInput,
  SaveConversationSnapshotInput,
  SaveDecisionInput,
  SavedConversationSnapshot,
  SavedDecisionRecord,
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
