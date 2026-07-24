import type { DomainEventTimelineEntryDTO } from "@/server/observer-console/types";

export function UnmatchedEventsPanel({ events }: { events: DomainEventTimelineEntryDTO[] }) {
  if (events.length === 0) return null;

  return (
    <details className="rounded-xl border border-neutral-200 bg-white p-3 text-sm text-neutral-500" data-testid="unmatched-events-panel">
      <summary className="cursor-pointer font-medium text-neutral-600">
        Events with no observations ({events.length})
      </summary>
      <ul className="mt-2 space-y-1">
        {events.map((event) => (
          <li key={event.id}>
            {new Date(event.occurredAt).toLocaleString()} — {event.eventType}
          </li>
        ))}
      </ul>
    </details>
  );
}
