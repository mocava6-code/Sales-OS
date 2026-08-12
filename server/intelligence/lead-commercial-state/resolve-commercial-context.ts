// The "current commercial context" conversation — distinct from the
// operationally-active conversation (active-conversation.ts). The active
// conversation answers "what's the most recent thing that happened with
// this customer" (used for lastContactAt/lastContactDirection/
// conversationState — legitimately about raw activity, commercial or
// not: an unanswered personal message still means the thread needs a
// reply). This resolves a narrower question: "which conversation's
// commercial content should the mutable commercial fields (product,
// vehicle, delivery, payment) be scoped to right now."
//
// Raw last-entry recency is the wrong signal for that question, because a
// conversation can accumulate new activity that has nothing to do with
// the commercial inquiry itself (personal chatter, stickers, test noise)
// while an older-looking conversation is still the one carrying the live
// inquiry. Confirmed against real production data: a MANUAL_ENTRY
// conversation containing an old test payment-request exchange kept
// winning "active" status purely because unrelated personal messages
// were appended to it later, resurfacing a dormant fake CONFIRM_PAYMENT
// signal over a genuinely active WhatsApp-synced product inquiry.
//
// Definition: among conversations that produced at least one field
// candidate (of any mutable field, from any extractor), pick the one
// whose LATEST candidate is most recent — preferring non-CLOSED
// conversations, same closed-fallback rule resolveActiveConversation
// already uses. Falls back to the operationally-active conversation when
// no conversation produced any commercial candidate at all (nothing to
// disambiguate).

import type { ConversationSummaryForActiveResolution } from "./types";

export interface CommercialCandidateForContextResolution {
  conversationId: string;
  occurredAt: Date;
}

export function resolveCommercialContextConversationId(
  candidates: CommercialCandidateForContextResolution[],
  conversations: ConversationSummaryForActiveResolution[],
  fallbackActiveConversationId: string,
): string {
  if (candidates.length === 0) return fallbackActiveConversationId;

  const latestByConversation = new Map<string, number>();
  for (const candidate of candidates) {
    const occurredAtMs = candidate.occurredAt.getTime();
    const existing = latestByConversation.get(candidate.conversationId);
    if (existing === undefined || occurredAtMs > existing) {
      latestByConversation.set(candidate.conversationId, occurredAtMs);
    }
  }

  const statusById = new Map(conversations.map((c) => [c.id, c.status]));
  // Only conversations we actually know about (belong to this lead) count.
  const candidateConversationIds = [...latestByConversation.keys()].filter((id) => statusById.has(id));
  if (candidateConversationIds.length === 0) return fallbackActiveConversationId;

  const nonClosed = candidateConversationIds.filter((id) => statusById.get(id) !== "CLOSED");
  const pool = nonClosed.length > 0 ? nonClosed : candidateConversationIds;

  return pool.slice().sort((a, b) => latestByConversation.get(b)! - latestByConversation.get(a)!)[0];
}
