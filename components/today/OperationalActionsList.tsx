import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { ACTION_REASON_CODE_LABELS } from "@/server/intelligence/response-action/reason-codes";
import type { TodayActionGroups, TodayActionGroupEntry } from "@/server/services/conversation-action-state-service";
import { formatWaitingSince } from "./waiting-duration";

// Semantic Response Intelligence, surfaced — the ONE place Today reads
// "what does this advisor actually need to do," through
// groupLeadsByOperationalActionState (server/services/
// conversation-action-state-service.ts), never a raw Conversation.status
// count. NO_ACTION_REQUIRED is deliberately never rendered here — it must
// not clutter the main action queue.
//
// Order follows the mission spec verbatim: Responder ahora (REPLY_REQUIRED)
// -> Seguimiento (FOLLOW_UP_REQUIRED) -> Revisar (UNCERTAIN) -> Esperando
// al cliente (WAITING_ON_CUSTOMER). UNCERTAIN gets its own clearly-labeled
// "Revisar" section — never disguised as any of the other four states.
const SECTIONS: { key: keyof TodayActionGroups; title: string; emptyText: string }[] = [
  { key: "replyRequired", title: "Responder ahora", emptyText: "Nothing needs a reply right now." },
  { key: "followUpRequired", title: "Seguimiento", emptyText: "No pending follow-ups." },
  { key: "uncertain", title: "Revisar", emptyText: "Nothing needs review." },
  { key: "waitingOnCustomer", title: "Esperando al cliente", emptyText: "Not waiting on any customer." },
];

function vehicleOrProductLine(entry: TodayActionGroupEntry): string | null {
  const vehicle = [entry.vehicleBrand, entry.vehicleModel].filter(Boolean).join(" ");
  const parts = [vehicle || null, entry.productInterest].filter(Boolean);
  return parts.length > 0 ? parts.join(" — ") : null;
}

function ActionItem({ entry, now }: { entry: TodayActionGroupEntry; now: Date }) {
  const reasonLabel = ACTION_REASON_CODE_LABELS[entry.reasonCode as keyof typeof ACTION_REASON_CODE_LABELS] ?? entry.reasonCode;
  const vehicleLine = vehicleOrProductLine(entry);

  return (
    <li className="py-3">
      <Link href={`/leads/${entry.leadId}`} className="block">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate font-medium text-neutral-900">{entry.leadName || entry.leadPhone}</p>
          {entry.lastActivityAt ? <span className="shrink-0 text-xs text-neutral-400">{formatWaitingSince(entry.lastActivityAt, now)}</span> : null}
        </div>
        <p className="truncate text-sm text-neutral-500">{entry.leadPhone}</p>
        {vehicleLine ? <p className="truncate text-sm text-neutral-500">{vehicleLine}</p> : null}
        <p className="mt-1 text-sm text-neutral-700">{reasonLabel}</p>
        {entry.recommendedAction ? <p className="text-sm text-neutral-500">→ {entry.recommendedAction}</p> : null}
        {entry.assignedAdvisorName ? <p className="mt-1 text-xs text-neutral-400">Assigned to {entry.assignedAdvisorName}</p> : null}
      </Link>
    </li>
  );
}

export function OperationalActionsList({ groups, now }: { groups: TodayActionGroups; now: Date }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-neutral-900">Actions requiring attention</h2>

      {SECTIONS.map(({ key, title, emptyText }) => {
        const entries = groups[key];
        return (
          <Card key={key}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-neutral-500">{title}</h3>
              {entries.length > 0 ? <span className="text-xs text-neutral-400">{entries.length}</span> : null}
            </div>
            {entries.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-400">{emptyText}</p>
            ) : (
              <ul className="mt-1 divide-y divide-neutral-100">
                {entries.map((entry) => (
                  <ActionItem key={entry.conversationId ?? entry.leadId} entry={entry} now={now} />
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </section>
  );
}
