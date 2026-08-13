import Link from "next/link";
import { Card } from "@/components/ui/Card";
import type { InsightCardType, KoriInsightsSummary } from "@/server/services/kori-insights-service";

const CARD_STYLE: Record<InsightCardType, { icon: string; className: string }> = {
  OPORTUNIDAD: { icon: "🚨", className: "bg-emerald-50 text-emerald-900" },
  TENDENCIA: { icon: "📈", className: "bg-indigo-50 text-indigo-900" },
  PROBLEMA: { icon: "⚠️", className: "bg-red-50 text-red-900" },
  DATO_FALTANTE: { icon: "🔍", className: "bg-neutral-100 text-neutral-700" },
};

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function KoriInsights({ insights, canImportHistory }: { insights: KoriInsightsSummary; canImportHistory: boolean }) {
  return (
    <section className="space-y-2">
      <h2 className="px-0.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">Aprendizajes de Kori</h2>

      <Card>
        <p className="text-sm leading-relaxed text-neutral-600">{insights.executiveSummary}</p>

        {insights.cards.length > 0 && (
          <div className="mt-3 space-y-2 border-t border-neutral-100 pt-3">
            {insights.cards.map((card, index) => {
              const style = CARD_STYLE[card.type];
              return (
                <div key={`${card.type}-${index}`} className={`flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-sm leading-snug ${style.className}`}>
                  <span>{style.icon}</span>
                  <span>{card.text}</span>
                </div>
              );
            })}
          </div>
        )}

        {insights.productPerformance.length > 0 && (
          <div className="mt-4 border-t border-neutral-100 pt-3">
            <p className="mb-1.5 text-xs font-medium text-neutral-500">Rendimiento de producto — últimos {insights.periodDays} días</p>
            <ul className="space-y-1">
              {insights.productPerformance.map((product) => (
                <li key={product.product} className="flex items-center justify-between text-sm text-neutral-700">
                  <span className="truncate">{product.product}</span>
                  <span className="shrink-0 text-xs text-neutral-400">
                    {product.interested} {product.interested === 1 ? "interesado" : "interesados"}
                    {product.decided > 0 && product.conversionRate !== null ? ` · ${pct(product.conversionRate)} conversión` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {insights.showHistoricalImportNudge && canImportHistory && (
        <Link href="/settings/whatsapp/import" className="block">
          <Card className="flex items-center justify-between gap-3 bg-indigo-50">
            <p className="text-sm leading-snug text-indigo-900">
              <span className="font-semibold">📥 Kori solo ve tus conversaciones desde que conectaste WhatsApp.</span> Importa tu historial anterior para
              darle más contexto.
            </p>
            <span className="shrink-0 text-sm font-medium text-indigo-700">Importar →</span>
          </Card>
        </Link>
      )}
    </section>
  );
}
