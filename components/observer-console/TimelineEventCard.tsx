import { Card } from "@/components/ui/Card";
import type { DomainEventTimelineEntryDTO } from "@/server/observer-console/types";
import { formatDateTime } from "@/lib/copy/format";
import { OBSERVER_EVENT_TYPE_LABELS } from "@/lib/copy/labels";
import { ObservationBadge } from "./ObservationBadge";

export function TimelineEventCard({ event }: { event: DomainEventTimelineEntryDTO }) {
  return (
    <Card className="space-y-2" data-testid="timeline-event-card">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-neutral-700">{OBSERVER_EVENT_TYPE_LABELS[event.eventType]}</span>
        <time className="text-xs text-neutral-400" dateTime={event.occurredAt}>
          {formatDateTime(new Date(event.occurredAt))}
        </time>
      </div>

      {event.conversationEntry && (
        <p className="text-sm text-neutral-800">
          <span className="text-neutral-400">[{event.conversationEntry.direction}]</span> {event.conversationEntry.content}
        </p>
      )}

      {event.observations.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {event.observations.map((observation) => (
            <ObservationBadge key={observation.id} observation={observation} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-neutral-400">No se derivaron observaciones de este evento.</p>
      )}
    </Card>
  );
}
