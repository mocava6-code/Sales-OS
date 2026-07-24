import { Card } from "@/components/ui/Card";
import type { ConversationTimelineDTO } from "@/server/observer-console/types";
import { TimelineEventCard } from "./TimelineEventCard";
import { UnmatchedEventsPanel } from "./UnmatchedEventsPanel";

export function ConversationTimeline({ timeline }: { timeline: ConversationTimelineDTO }) {
  const unmatchedEvents = timeline.events.filter((event) => event.observations.length === 0);

  return (
    <div className="space-y-4" data-testid="conversation-timeline">
      <Card className="space-y-1">
        <h1 className="text-lg font-semibold text-neutral-900">{timeline.leadName}</h1>
        <p className="text-sm text-neutral-500">
          {timeline.leadPhone} · {timeline.channel} · {timeline.status}
        </p>
      </Card>

      <div className="space-y-3">
        {timeline.events.length === 0 ? (
          <Card>
            <p className="text-sm text-neutral-500">No domain events recorded for this conversation yet.</p>
          </Card>
        ) : (
          timeline.events.map((event) => <TimelineEventCard key={event.id} event={event} />)
        )}
      </div>

      <UnmatchedEventsPanel events={unmatchedEvents} />
    </div>
  );
}
