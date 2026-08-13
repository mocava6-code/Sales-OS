import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { formatRelativeTime } from "@/lib/copy/format";
import { ACTION_REASON_CODE_LABELS } from "@/server/intelligence/response-action/reason-codes";
import type { KoriOpportunity } from "@/server/services/kori-briefing-service";

const TAG_LABEL: Record<KoriOpportunity["kind"], string> = {
  buying_signal: "Señal de compra",
  stalled_commitment: "Compromiso pendiente",
};

const TAG_CLASS: Record<KoriOpportunity["kind"], string> = {
  buying_signal: "bg-emerald-100 text-emerald-800",
  stalled_commitment: "bg-amber-100 text-amber-800",
};

export function KoriOpportunitiesList({ opportunities, now }: { opportunities: KoriOpportunity[]; now: Date }) {
  if (opportunities.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-0.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Oportunidades detectadas</h2>
        <span className="font-mono text-xs text-neutral-400">{opportunities.length}</span>
      </div>

      <div className="space-y-2">
        {opportunities.map((opp) => (
          <Link key={opp.leadId} href={`/leads/${opp.leadId}`} className="block">
            <Card className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">◆</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900">{opp.leadName}</p>
                <p className="text-xs text-neutral-500">
                  {[opp.vehicleLine, ACTION_REASON_CODE_LABELS[opp.reasonCode]].filter(Boolean).join(" · ")}
                  {opp.waitingSince ? ` · ${formatRelativeTime(opp.waitingSince, now)}` : ""}
                </p>
                <span className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${TAG_CLASS[opp.kind]}`}>
                  {TAG_LABEL[opp.kind]}
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
