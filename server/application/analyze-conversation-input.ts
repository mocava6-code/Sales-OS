// Pure mapping from CRM conversation data to the engine's channel-neutral
// input shape. No Prisma types, no I/O — fully unit-testable on its own
// (see server/application/__tests__/analyze-conversation-input.test.ts).

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

/**
 * Always re-sorts entries by occurredAt, regardless of the order they're
 * passed in — the guarantee that engine input is chronological lives here,
 * not in whatever query loaded the conversation.
 */
export function buildEngineInputFromConversation(
  businessId: string,
  conversation: Pick<AuthorizedConversation, "channel" | "entries">,
): ConversationIntelligenceInput {
  const messages: NormalizedMessage[] = [...conversation.entries]
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((entry) => ({
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
