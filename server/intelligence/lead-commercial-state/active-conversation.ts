// Active conversation resolution — the one piece of context every
// conversation-scoped field (lastContactAt, lastContactDirection,
// conversationState) and every mutable-field fold (productInterest,
// vehicleModel, deliveryLocation, requestedDeliveryAt, paymentStatus)
// depends on.
//
// Definition: the most recently active NON-CLOSED conversation; if every
// conversation is CLOSED, the most recently closed one. Never "the most
// recent conversation regardless of status" — a customer who closed a deal
// last month and opened a brand-new inquiry yesterday should see the new
// thread's state, not the closed one's.

import type { ConversationSummaryForActiveResolution } from "./types";

export function resolveActiveConversation(
  conversations: ConversationSummaryForActiveResolution[],
): ConversationSummaryForActiveResolution | null {
  if (conversations.length === 0) return null;

  const nonClosed = conversations.filter((c) => c.status !== "CLOSED");
  const pool = nonClosed.length > 0 ? nonClosed : conversations;

  return pool.slice().sort((a, b) => b.lastEntryAt.getTime() - a.lastEntryAt.getTime())[0];
}
