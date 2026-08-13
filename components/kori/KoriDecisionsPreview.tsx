import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { formatRelativeTime } from "@/lib/copy/format";
import type { PendingDecisionPreview } from "@/server/services/decision-service";

export function KoriDecisionsPreview({ decisions, now }: { decisions: PendingDecisionPreview[]; now: Date }) {
  return (
    <section className="space-y-2">
      <h2 className="px-0.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">Kori está monitoreando</h2>

      {decisions.length === 0 ? (
        <Card className="py-5 text-center">
          <p className="mb-1 text-lg">◇</p>
          <p className="text-xs leading-relaxed text-neutral-500">
            Todavía no hay decisiones que revisar. En cuanto Kori proponga una acción sobre un cliente, aparecerá aquí primero.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {decisions.map((decision) => (
            <Link key={decision.id} href={`/decisions/${decision.id}`} className="block">
              <Card className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-900">{decision.title}</p>
                  <p className="truncate text-xs text-neutral-500">{decision.leadName}</p>
                </div>
                <span className="shrink-0 text-xs text-neutral-400">{formatRelativeTime(decision.createdAt, now)}</span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
