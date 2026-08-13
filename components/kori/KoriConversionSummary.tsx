import { Card } from "@/components/ui/Card";
import type { KoriConversionSummary as KoriConversionSummaryData } from "@/server/services/conversion-intelligence-service";

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function KoriConversionSummary({ summary }: { summary: KoriConversionSummaryData }) {
  return (
    <section className="space-y-2">
      <h2 className="px-0.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">Cómo estamos vendiendo este mes</h2>

      <Card>
        <p className="mb-3 text-sm text-neutral-600">
          <span className="font-semibold text-neutral-900">{summary.commercialConversations}</span> conversaciones comerciales
        </p>
        <div className="grid grid-cols-4 gap-2">
          <div className="rounded-xl border border-neutral-200 px-2.5 py-2.5">
            <div className="text-xl font-semibold tabular-nums text-emerald-700">{summary.closed}</div>
            <div className="mt-0.5 text-[11px] leading-tight text-neutral-400">Ventas cerradas</div>
          </div>
          <div className="rounded-xl border border-neutral-200 px-2.5 py-2.5">
            <div className="text-xl font-semibold tabular-nums text-red-700">{summary.lost}</div>
            <div className="mt-0.5 text-[11px] leading-tight text-neutral-400">Pérdidas</div>
          </div>
          <div className="rounded-xl border border-neutral-200 px-2.5 py-2.5">
            <div className="text-xl font-semibold tabular-nums text-neutral-900">{summary.pending}</div>
            <div className="mt-0.5 text-[11px] leading-tight text-neutral-400">Pendientes</div>
          </div>
          <div className="rounded-xl border border-neutral-200 px-2.5 py-2.5">
            <div className="text-xl font-semibold tabular-nums text-neutral-900">
              {summary.conversionRate !== null ? pct(summary.conversionRate) : "—"}
            </div>
            <div className="mt-0.5 text-[11px] leading-tight text-neutral-400">Conversión</div>
          </div>
        </div>

        {summary.topLostReasons.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-medium text-neutral-500">Razones de pérdida más comunes</p>
            <ul className="space-y-1">
              {summary.topLostReasons.map((reason) => (
                <li key={reason.reason} className="flex items-center justify-between text-sm text-neutral-700">
                  <span>{reason.label}</span>
                  <span className="text-neutral-400">{reason.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {summary.productConversion.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-medium text-neutral-500">Conversión por producto</p>
            <ul className="space-y-1">
              {summary.productConversion.slice(0, 4).map((product) => (
                <li key={product.product} className="flex items-center justify-between text-sm text-neutral-700">
                  <span className="truncate">{product.product}</span>
                  <span className="shrink-0 text-neutral-400">
                    {pct(product.conversionRate)} · {product.decided}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {summary.avgSalesCycleDays !== null && (
          <p className="mt-4 text-xs text-neutral-400">Ciclo de venta promedio: {Math.round(summary.avgSalesCycleDays)} días</p>
        )}

        {summary.insight && <p className="mt-4 border-l-2 border-indigo-200 pl-3 text-sm italic text-neutral-600">{summary.insight}</p>}
      </Card>
    </section>
  );
}
