// Read-model assembly service — NOT a pure function: it performs
// repository I/O (three read calls) via its injected dependencies, then
// merges the results into one chronological structure. "Pure" here would
// misdescribe it; "assembly" is the operative word — there is no business
// logic, no decision-making, and no write path, only shaping already-stored
// data for display.
//
// Only returns the `events` portion of ConversationTimelineDTO — the
// conversation header (leadName/leadPhone/channel/status) comes from the
// tenant-scoped access-control lookup and is merged in by
// server/application/dto.ts, never duplicated here.

import type { ConversationEntryRecord, SavedDomainEventRecord, SavedObservationRecord } from "../persistence/types";
import { DETECTOR_REGISTRY } from "./detector-registry";
import { compareByOccurredAtThenId } from "./ordering";
import type {
  ConversationEntryProjectionDTO,
  DomainEventTimelineEntryDTO,
  ObservationTimelineEntryDTO,
  ObserverConsoleReadDependencies,
} from "./types";

export type BuildConversationTimelineDependencies = Pick<
  ObserverConsoleReadDependencies,
  "domainEvents" | "observations" | "conversationEntries"
>;

function toConversationEntryProjectionDTO(entry: ConversationEntryRecord | undefined): ConversationEntryProjectionDTO | null {
  if (!entry) return null;
  return {
    id: entry.id,
    direction: entry.direction,
    content: entry.content,
    messageType: entry.messageType,
    occurredAt: entry.occurredAt.toISOString(),
    mediaMimeType: entry.mediaMimeType ?? undefined,
    mediaFilename: entry.mediaFilename ?? undefined,
    mediaCaption: entry.mediaCaption ?? undefined,
  };
}

function toObservationTimelineEntryDTO(saved: SavedObservationRecord): ObservationTimelineEntryDTO {
  return {
    id: saved.id,
    type: saved.observation.type,
    summary: saved.observation.summary,
    evidenceExcerpt: saved.observation.evidence[0]?.excerpt ?? null,
    detector: DETECTOR_REGISTRY[saved.observation.type],
    occurredAt: saved.occurredAt.toISOString(),
  };
}

function groupByDomainEventId(observations: SavedObservationRecord[]): Map<string, SavedObservationRecord[]> {
  const map = new Map<string, SavedObservationRecord[]>();
  for (const observation of observations) {
    const list = map.get(observation.domainEventId) ?? [];
    list.push(observation);
    map.set(observation.domainEventId, list);
  }
  return map;
}

function toDomainEventTimelineEntryDTO(
  event: SavedDomainEventRecord,
  observationsByEvent: Map<string, SavedObservationRecord[]>,
  entriesById: Map<string, ConversationEntryRecord>,
): DomainEventTimelineEntryDTO {
  const observations = (observationsByEvent.get(event.id) ?? []).slice().sort(compareByOccurredAtThenId);

  return {
    id: event.id,
    eventType: event.eventType,
    occurredAt: event.occurredAt.toISOString(),
    conversationEntry: event.conversationEntryId
      ? toConversationEntryProjectionDTO(entriesById.get(event.conversationEntryId))
      : null,
    observations: observations.map(toObservationTimelineEntryDTO),
  };
}

/**
 * Fetches a conversation's DomainEvents, Observations, and ConversationEntries
 * (three parallel repository reads — no transaction, no snapshot isolation
 * across them; acceptable for an internal debugging view, revisit only if
 * it matters) and merges them into one chronological list. Re-sorts
 * defensively with the same compareByOccurredAtThenId rule the
 * repositories already apply, so this function's correctness never depends
 * on the caller having passed pre-sorted input.
 */
export async function buildConversationTimeline(
  conversationId: string,
  dependencies: BuildConversationTimelineDependencies,
): Promise<DomainEventTimelineEntryDTO[]> {
  const [events, observations, entries] = await Promise.all([
    dependencies.domainEvents.listForConversation(conversationId),
    dependencies.observations.listForConversation(conversationId),
    dependencies.conversationEntries.listForConversation(conversationId),
  ]);

  const sortedEvents = events.slice().sort(compareByOccurredAtThenId);
  const observationsByEvent = groupByDomainEventId(observations);
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));

  return sortedEvents.map((event) => toDomainEventTimelineEntryDTO(event, observationsByEvent, entriesById));
}
