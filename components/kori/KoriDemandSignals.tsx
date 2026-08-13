import { Card } from "@/components/ui/Card";
import type { KoriBriefing } from "@/server/services/kori-briefing-service";

export function KoriDemandSignals({
  demandSignals,
  demandWindowDays,
  demandSampleSize,
}: {
  demandSignals: KoriBriefing["demandSignals"];
  demandWindowDays: number;
  demandSampleSize: number;
}) {
  return (
    <section className="space-y-2">
      <h2 className="px-0.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Señales de demanda — últimos {demandWindowDays} días
      </h2>

      <Card>
        {demandSignals.length === 0 ? (
          <p className="py-2 text-xs text-neutral-500">Todavía no hay suficientes clientes nuevos este período para mostrar una tendencia.</p>
        ) : (
          <>
            <div className="space-y-2.5">
              {demandSignals.map((signal) => {
                const maxCount = demandSignals[0].count;
                const widthPercent = maxCount > 0 ? Math.max(6, Math.round((signal.count / maxCount) * 100)) : 0;
                return (
                  <div key={signal.label} className="flex items-center gap-2.5">
                    <span className="w-28 shrink-0 truncate text-sm font-medium text-neutral-700">{signal.label}</span>
                    <div className="h-[7px] flex-1 overflow-hidden rounded-full bg-neutral-100">
                      <div className="h-full rounded-full bg-indigo-700" style={{ width: `${widthPercent}%` }} />
                    </div>
                    <span className="w-16 shrink-0 text-right text-xs tabular-nums text-neutral-400">
                      {signal.count} · {signal.percentage}%
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[11px] text-neutral-400">Sobre {demandSampleSize} clientes registrados en este período.</p>
          </>
        )}
      </Card>
    </section>
  );
}
