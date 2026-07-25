// lastContactAt/lastContactDirection/conversationState are never extracted
// from text or folded across history — they're direct reads of the active
// conversation's own row (Conversation.lastEntryAt/lastEntryDirection/status,
// already correctly maintained at write time by
// server/services/conversation-service.ts and server/whatsapp/queue.ts).
// Re-deriving them here would duplicate logic that's already correct.

import type { Evidence, Fact } from "../types";
import type { ActiveConversationContext, ConversationCommercialState } from "./types";

export interface ConversationFacts {
  lastContactAt: Fact<Date>;
  lastContactDirection: Fact<"INBOUND" | "OUTBOUND">;
  conversationState: Fact<ConversationCommercialState>;
}

export function resolveConversationFacts(context: ActiveConversationContext): ConversationFacts {
  const evidence: Evidence[] = [{ sourceType: "conversation_message", sourceId: context.activeConversationId }];

  return {
    lastContactAt: { kind: "fact", value: context.lastContactAt, confidence: 1, evidence },
    lastContactDirection: { kind: "fact", value: context.lastContactDirection, confidence: 1, evidence },
    conversationState: { kind: "fact", value: context.conversationState, confidence: 1, evidence },
  };
}
