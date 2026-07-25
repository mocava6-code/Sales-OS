// The revised candidate-folding rule (Sprint 7 correction): a mutable field
// (productInterest, vehicleModel, deliveryLocation, requestedDeliveryAt,
// paymentStatus) must never be permanently frozen by an old high-confidence
// candidate once a newer, equally-valid one exists in the active
// conversation. Precedence, strictly in this order:
//
//   1. Conversation scope — candidates from the active conversation are
//      preferred outright; historical (other-conversation) candidates are
//      only ever considered when the active conversation produced none.
//   2. Confidence (a proxy for explicitness — extractors are responsible
//      for assigning it, not this fold).
//   3. Recency (evidence timestamp) — a tie-break only, never overrides #1/#2.
//
// This is structurally different from "most recent wins": a vague mention
// in the active conversation does NOT automatically outrank a precise
// catalog match in the active conversation just because the fold is
// recency-based — confidence is checked first, within the active pool.

import type { Evidence } from "../types";
import type { FieldCandidate } from "./types";

export interface FoldedField<T> {
  value: T;
  confidence: number;
  evidence: Evidence[];
  reasoning?: string;
}

export function foldMutableFieldCandidates<T>(
  candidates: FieldCandidate<T>[],
  activeConversationId: string,
): FoldedField<T> | null {
  if (candidates.length === 0) return null;

  const activeCandidates = candidates.filter((c) => c.conversationId === activeConversationId);
  const pool = activeCandidates.length > 0 ? activeCandidates : candidates;

  const [winner] = pool.slice().sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.occurredAt.getTime() - a.occurredAt.getTime();
  });

  return { value: winner.value, confidence: winner.confidence, evidence: winner.evidence, reasoning: winner.reasoning };
}
