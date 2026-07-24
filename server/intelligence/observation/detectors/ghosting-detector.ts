// CUSTOMER_GHOSTED — the one stateful/time-based detector. Unlike the
// keyword detectors, this never inspects message content; it only reasons
// about elapsed time, which the caller supplies (the engine never queries
// the database — see server/domain-events/types.ts's previousEntry doc
// comment).
//
// No cron/scheduled scan exists for this yet (ARCHITECTURE.md §7 defers
// background jobs generally) — this only fires from events the system
// already processes. A conversation that simply goes silent forever, with
// no new inbound message and no explicit close, is never retroactively
// flagged until a future scheduled job is built. See ARCHITECTURE.md §19.

import type { ConversationClosedEvent, DomainEvent, MessageReceivedEvent } from "../../../domain-events/types";
import type { Observation } from "../types";

export const GHOSTING_THRESHOLD_HOURS = 24;

function hoursBetween(earlier: Date, later: Date): number {
  return (later.getTime() - earlier.getTime()) / (1000 * 60 * 60);
}

function toGhostedObservation(summary: string, sourceId: string): Observation {
  return {
    type: "CUSTOMER_GHOSTED",
    summary,
    evidence: [{ sourceType: "conversation_message", sourceId }],
  };
}

/** Customer went quiet after the advisor's last message, then eventually replied. */
function detectFromMessageReceived(event: MessageReceivedEvent): Observation | null {
  const previous = event.previousEntry;
  if (!previous || previous.direction !== "INBOUND") return null;

  const gapHours = hoursBetween(previous.occurredAt, event.occurredAt);
  if (gapHours < GHOSTING_THRESHOLD_HOURS) return null;

  return toGhostedObservation(
    `Customer went quiet for over ${GHOSTING_THRESHOLD_HOURS}h before replying again.`,
    event.conversationEntryId,
  );
}

/** The advisor's last message was never answered before the thread closed. */
function detectFromConversationClosed(event: ConversationClosedEvent): Observation | null {
  if (event.lastEntryDirection !== "OUTBOUND") return null;

  const gapHours = hoursBetween(event.lastEntryAt, event.occurredAt);
  if (gapHours < GHOSTING_THRESHOLD_HOURS) return null;

  return toGhostedObservation(
    `Conversation closed over ${GHOSTING_THRESHOLD_HOURS}h after the advisor's last unanswered message.`,
    event.conversationId,
  );
}

export function detectCustomerGhosted(event: DomainEvent): Observation | null {
  switch (event.type) {
    case "MESSAGE_RECEIVED":
      return detectFromMessageReceived(event);
    case "CONVERSATION_CLOSED":
      return detectFromConversationClosed(event);
    default:
      return null;
  }
}
