import { Card } from "@/components/ui/Card";
import type { DecisionSummaryDTO } from "@/server/application/dto";
import { formatDateTime } from "@/lib/copy/format";
import { DECISION_APPROVAL_LABELS, DECISION_IMPACT_LABELS, DECISION_RISK_LABELS, DECISION_STATUS_LABELS } from "@/lib/copy/labels";

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
      {children}
    </span>
  );
}

export function DecisionReviewCard({ decision }: { decision: DecisionSummaryDTO }) {
  return (
    <Card className="space-y-4" data-testid="decision-review-card">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-neutral-900">{decision.title}</h1>
          <Badge>{DECISION_STATUS_LABELS[decision.status]}</Badge>
        </div>
        <p className="text-sm text-neutral-500">{decision.objective}</p>
      </header>

      <section>
        <h2 className="text-sm font-medium text-neutral-500">Recomendación</h2>
        <p className="mt-1 text-neutral-900">{decision.recommendation}</p>
      </section>

      <section>
        <h2 className="text-sm font-medium text-neutral-500">Razonamiento</h2>
        <p className="mt-1 text-neutral-800">{decision.reasoning}</p>
      </section>

      <section className="flex flex-wrap gap-2">
        <Badge>Confianza {Math.round(decision.confidence * 100)}%</Badge>
        <Badge>{DECISION_RISK_LABELS[decision.riskLevel]}</Badge>
        <Badge>{DECISION_IMPACT_LABELS[decision.impactLevel]}</Badge>
        <Badge>{DECISION_APPROVAL_LABELS[decision.approvalRequirement]}</Badge>
      </section>

      {decision.evidence.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-neutral-500">Evidencia</h2>
          <ul className="mt-1 space-y-1">
            {decision.evidence.map((item, index) => (
              <li key={index} className="text-sm text-neutral-700">
                <span className="text-neutral-400">[{item.sourceType}]</span> {item.excerpt ?? item.sourceId}
              </li>
            ))}
          </ul>
        </section>
      )}

      {decision.missingInformation.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-neutral-500">Información faltante</h2>
          <ul className="mt-1 space-y-1">
            {decision.missingInformation.map((item, index) => (
              <li key={index} className="text-sm text-amber-700">
                {item.field}
                {item.reason ? ` — ${item.reason}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {decision.alternatives.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-neutral-500">Alternativas</h2>
          <ul className="mt-1 space-y-2">
            {decision.alternatives.map((alt, index) => (
              <li key={index} className="text-sm">
                <p className="font-medium text-neutral-800">{alt.title}</p>
                <p className="text-neutral-600">{alt.recommendation}</p>
                {alt.tradeoff && <p className="text-neutral-400">Compromiso: {alt.tradeoff}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="rounded-xl border border-neutral-100 p-3 text-sm text-neutral-500">
        <summary className="cursor-pointer font-medium text-neutral-600">Detalles técnicos</summary>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          <dt className="text-neutral-400">Modelo</dt>
          <dd>{decision.metadata.modelName}</dd>
          <dt className="text-neutral-400">Proveedor</dt>
          <dd>{decision.metadata.aiProvider}</dd>
          <dt className="text-neutral-400">Versión del prompt</dt>
          <dd>{decision.metadata.promptVersion}</dd>
          <dt className="text-neutral-400">Esquema del motor</dt>
          <dd>v{decision.metadata.engineSchemaVersion}</dd>
          <dt className="text-neutral-400">Decidido el</dt>
          <dd>{formatDateTime(new Date(decision.metadata.decidedAt))}</dd>
        </dl>
      </details>
    </Card>
  );
}
