import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { formatRelativeTime } from "@/lib/copy/format";
import { ACTION_REASON_CODE_LABELS } from "@/server/intelligence/response-action/reason-codes";
import type { KoriNeedsOutcomeNudge } from "@/server/services/kori-briefing-service";

export function KoriNeedsOutcomeNudges({ nudges, now }: { nudges: KoriNeedsOutcomeNudge[]; now: Date }) {
  if (nudges.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-0.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">¿Qué pasó con estos clientes?</h2>
        <span className="font-mono text-xs text-neutral-400">{nudges.length}</span>
      </div>

      <div className="space-y-2">
        {nudges.map((nudge) => (
          <Link key={nudge.leadId} href={`/leads/${nudge.leadId}`} className="block">
            <Card className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">?</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900">{nudge.leadName}</p>
                <p className="text-xs text-neutral-500">
                  {[nudge.vehicleLine, ACTION_REASON_CODE_LABELS[nudge.reasonCode]].filter(Boolean).join(" · ")}
                  {nudge.waitingSince ? ` · ${formatRelativeTime(nudge.waitingSince, now)}` : ""}
                </p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
