// Kori Semantic Response Intelligence v0 — public contracts.
//
// This module answers a genuinely different question than
// Conversation.status: "which side sent the last message" (a transport
// fact — server/services/conversation-service.ts flips it on every
// append) is NOT the same claim as "does an advisor actually need to do
// something here." A customer's "ok gracias" is INBOUND (mechanically
// unanswered) but usually needs nothing; an advisor's own last message
// promising a quotation is OUTBOUND (mechanically answered) but often
// still has work outstanding. See
// server/services/conversation-action-state-service.ts's
// resolveOperationalActionState for the one canonical place these two
// concepts get reconciled — Today/Kori/analytics must all read through it,
// never re-derive this independently from Conversation.status.
//
// Mirrors server/db/schema.prisma's ConversationActionStateValue/
// ConversationActionStateSource enums verbatim (redeclared as plain
// string unions here rather than importing the Prisma client — same
// "keep the intelligence layer Prisma-agnostic" convention already used by
// server/intelligence/lead-commercial-state/types.ts's
// ConversationCommercialState).

import type { Evidence } from "../types";

export type ActionState = "REPLY_REQUIRED" | "FOLLOW_UP_REQUIRED" | "WAITING_ON_CUSTOMER" | "NO_ACTION_REQUIRED" | "UNCERTAIN";

export type ActionStateSource = "DETERMINISTIC" | "AI" | "HUMAN" | "FOLLOW_UP" | "DECISION_ENGINE";

/** One bounded, recent conversation entry — the classifier's raw input unit. */
export interface ActionClassificationEntry {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  content: string;
  occurredAt: Date;
}

/**
 * Structural signals already computed elsewhere in the codebase, reused
 * here rather than re-derived: LeadCommercialProfile.nextAction (Kori Data
 * Correctness Phase 1C/Legacy Data Remediation v0's deterministic+AI
 * hybrid) and FollowUp existence/overdueness (server/services/
 * follow-up-service.ts's own definition, reused verbatim — never a second,
 * slightly-different overdue rule).
 */
export interface StructuralCommitmentSignals {
  /** LeadCommercialProfile.nextAction for this conversation's lead, if a profile exists. */
  leadNextAction: "ANSWER_QUESTION" | "CONFIRM_PAYMENT" | "SCHEDULE_DELIVERY" | "SEND_QUOTE" | "FOLLOW_UP" | "NONE" | null;
  /** True when this lead has a PENDING FollowUp with dueAt in the past — server/services/follow-up-service.ts's listOverdueFollowUps definition. */
  hasOverdueFollowUp: boolean;
  /** True when this lead has any PENDING FollowUp at all (not necessarily overdue yet). */
  hasPendingFollowUp: boolean;
}

/** Everything the classifiers need for one conversation — deliberately bounded, never a full unbounded history dump. */
export interface ConversationActionContext {
  conversationId: string;
  leadId: string;
  /** Conversation.status — the observed, mechanical state. Provided for classifiers that want it as one more signal, never as the final answer on its own. */
  observedStatus: "NEEDS_REPLY" | "WAITING_ON_CUSTOMER" | "CLOSED";
  lastEntryDirection: "INBOUND" | "OUTBOUND";
  lastEntryAt: Date;
  /** Oldest -> newest, bounded window (see classify-conversation-action.ts for the exact size). */
  recentEntries: ActionClassificationEntry[];
  structural: StructuralCommitmentSignals;
}

export interface ActionClassificationResult {
  actionState: ActionState;
  reasonCode: string;
  confidence: number;
  reasoning: string;
  evidenceEntryIds: string[];
  recommendedAction: string | null;
  source: ActionStateSource;
}

/** Evidence-shaped view of an ActionClassificationResult, for callers that want the server/intelligence/types.ts Evidence[] convention instead of raw entry ids. */
export function toEvidence(result: Pick<ActionClassificationResult, "evidenceEntryIds">, entries: ActionClassificationEntry[]): Evidence[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return result.evidenceEntryIds
    .map((id) => byId.get(id))
    .filter((e): e is ActionClassificationEntry => e !== undefined)
    .map((e) => ({ sourceType: "conversation_message" as const, sourceId: e.id, excerpt: e.content }));
}
