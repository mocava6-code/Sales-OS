import { Card } from "@/components/ui/Card";
import { OBSERVATION_TYPE_FAMILY, OBSERVATION_TYPE_LABELS, type ObservationSignalFamily } from "@/lib/copy/labels";
import type { LeadSignalSummary } from "@/server/services/lead-signal-service";

const FAMILY_CLASS: Record<ObservationSignalFamily, string> = {
  friction: "bg-amber-100 text-amber-800",
  intent: "bg-emerald-100 text-emerald-800",
  geography: "bg-neutral-100 text-neutral-700",
};

/** Friction first (needs attention), then intent, then geography — same priority order a salesperson would actually care about. */
const FAMILY_ORDER: ObservationSignalFamily[] = ["friction", "intent", "geography"];

export function LeadSignalsCard({ signals }: { signals: LeadSignalSummary[] }) {
  if (signals.length === 0) return null;

  const sorted = [...signals].sort((a, b) => FAMILY_ORDER.indexOf(OBSERVATION_TYPE_FAMILY[a.type]) - FAMILY_ORDER.indexOf(OBSERVATION_TYPE_FAMILY[b.type]));

  return (
    <Card className="space-y-3" data-testid="lead-signals-card">
      <h2 className="text-sm font-medium text-neutral-500">Señales detectadas</h2>
      <ul className="space-y-2">
        {sorted.map((signal) => {
          const family = OBSERVATION_TYPE_FAMILY[signal.type];
          return (
            <li key={signal.type} className="flex items-start gap-2">
              <span className={`mt-0.5 inline-block shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${FAMILY_CLASS[family]}`}>
                {OBSERVATION_TYPE_LABELS[signal.type]}
                {signal.count > 1 ? ` (${signal.count})` : ""}
              </span>
              {signal.latestExcerpt && <span className="truncate text-xs text-neutral-400">&ldquo;{signal.latestExcerpt}&rdquo;</span>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
