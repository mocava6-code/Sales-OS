// Pure mapping from CRM conversation data to the engine's channel-neutral
// input shape. No Prisma types, no I/O — fully unit-testable on its own
// (see server/application/__tests__/analyze-conversation-input.test.ts).
//
// Shared by all three places that trigger Conversation Intelligence
// (server/whatsapp/gateway.ts's live webhook, server/application/
// decision-actions.ts's manual "Analizar conversación", and
// server/application/whatsapp-actions.ts's historical-import analysis) —
// bounding the transcript here bounds it everywhere at once.

import type { ChannelType, ConversationIntelligenceInput, NormalizedMessage } from "@/server/intelligence/types";
import type { AuthorizedConversation } from "./access-control";

function mapConversationChannel(channel: AuthorizedConversation["channel"]): ChannelType {
  switch (channel) {
    case "WHATSAPP":
      return "whatsapp";
    case "CALL":
    case "IN_PERSON":
    case "OTHER":
      return "manual";
  }
}

// Previously the ENTIRE conversation was resent on every single inbound
// message — for an N-message conversation, that's 1+2+...+N message-
// inclusions over its lifetime (quadratic), not N (linear). Confirmed
// against real production data: 506 historical inbound messages across 62
// conversations implied ~1.47M lifetime tokens, ~7x the 200K/day Groq
// budget, almost entirely spent on early analyses that could never succeed
// (the reasoning:null schema bug) — but the quadratic shape itself is a
// real, independent cost problem that would recur even with a healthy
// quota. ~4 chars/token is this codebase's established rough estimate
// (used consistently for cost auditing elsewhere) — 12,000 chars ≈ 3,000
// tokens, comfortably covering dozens of typical short WhatsApp messages
// while capping worst-case per-call cost once a conversation outgrows it.
export const MAX_ENGINE_INPUT_TRANSCRIPT_CHARS = 12_000;

/**
 * Keeps the most recent entries (by content length) that fit within
 * maxChars, dropping the oldest first — never drops below 1 entry
 * regardless of its size, since conversationIntelligenceInputSchema
 * requires at least one message. `sortedAscending` must already be in
 * chronological order; the returned slice preserves that order.
 *
 * Why bounding the AI's raw transcript this way is safe: the durable,
 * canonical facts a customer already established (vehicleBrand/Model/Year,
 * productInterest, customerType-when-explicit) are NOT solely dependent on
 * the AI re-deriving them from a message still in this window — they're
 * also independently, deterministically re-derived from the FULL
 * (unbounded, free, no-AI) message history on every projection run by
 * server/intelligence/lead-commercial-state/**, and
 * server/services/lead-commercial-profile-service.ts's resolveField never
 * lets a null candidate erase an existing value (see its own doc comment
 * and Kori Data Correctness Phase 1C). Only the AI-only, current-state
 * fields (sentiment, buyingIntent, compatibility, aiPriority, ...) reflect
 * just the latest bounded-window analysis — which is correct for fields
 * that describe "right now," not an accumulated history.
 */
function boundToRecentWindow<T extends { content: string }>(sortedAscending: T[], maxChars: number): T[] {
  const kept: T[] = [];
  let totalChars = 0;

  for (let i = sortedAscending.length - 1; i >= 0; i -= 1) {
    const entry = sortedAscending[i];
    const nextTotal = totalChars + entry.content.length;
    if (kept.length > 0 && nextTotal > maxChars) break;
    kept.unshift(entry);
    totalChars = nextTotal;
  }

  return kept;
}

/**
 * Always re-sorts entries by occurredAt, regardless of the order they're
 * passed in — the guarantee that engine input is chronological lives here,
 * not in whatever query loaded the conversation. Also bounds the transcript
 * to the most recent MAX_ENGINE_INPUT_TRANSCRIPT_CHARS worth of content —
 * see boundToRecentWindow's doc comment for why this is safe.
 */
export function buildEngineInputFromConversation(
  businessId: string,
  conversation: Pick<AuthorizedConversation, "channel" | "entries">,
): ConversationIntelligenceInput {
  const sorted = [...conversation.entries].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const windowed = boundToRecentWindow(sorted, MAX_ENGINE_INPUT_TRANSCRIPT_CHARS);

  const messages: NormalizedMessage[] = windowed.map((entry) => ({
    direction: entry.direction,
    content: entry.content,
    occurredAt: entry.occurredAt,
  }));

  return {
    tenantId: businessId,
    channel: mapConversationChannel(conversation.channel),
    messages,
  };
}
