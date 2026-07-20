import { Card } from "@/components/ui/Card";
import type { DecisionSummaryDTO } from "@/server/application/dto";

const STATUS_LABELS: Record<DecisionSummaryDTO["status"], string> = {
  PROPOSED: "Proposed",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  EXECUTED: "Executed",
  CANCELLED: "Cancelled",
  OVERRIDDEN: "Overridden",
};

const RISK_LABELS: Record<DecisionSummaryDTO["riskLevel"], string> = {
  LOW: "Low risk",
  MEDIUM: "Medium risk",
  HIGH: "High risk",
  CRITICAL: "Critical risk",
};

const IMPACT_LABELS: Record<DecisionSummaryDTO["impactLevel"], string> = {
  LOW: "Low impact",
  MEDIUM: "Medium impact",
  HIGH: "High impact",
};

const APPROVAL_LABELS: Record<DecisionSummaryDTO["approvalRequirement"], string> = {
  AUTO_ALLOWED: "Auto-allowed",
  ADVISOR_APPROVAL_REQUIRED: "Needs advisor approval",
  ADMIN_APPROVAL_REQUIRED: "Needs admin approval",
  HUMAN_INFORMATION_REQUIRED: "Needs more information",
};

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
          <Badge>{STATUS_LABELS[decision.status]}</Badge>
        </div>
        <p className="text-sm text-neutral-500">{decision.objective}</p>
      </header>

      <section>
        <h2 className="text-sm font-medium text-neutral-500">Recommendation</h2>
        <p className="mt-1 text-neutral-900">{decision.recommendation}</p>
      </section>

      <section>
        <h2 className="text-sm font-medium text-neutral-500">Reasoning</h2>
        <p className="mt-1 text-neutral-800">{decision.reasoning}</p>
      </section>

      <section className="flex flex-wrap gap-2">
        <Badge>Confidence {Math.round(decision.confidence * 100)}%</Badge>
        <Badge>{RISK_LABELS[decision.riskLevel]}</Badge>
        <Badge>{IMPACT_LABELS[decision.impactLevel]}</Badge>
        <Badge>{APPROVAL_LABELS[decision.approvalRequirement]}</Badge>
      </section>

      {decision.evidence.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-neutral-500">Evidence</h2>
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
          <h2 className="text-sm font-medium text-neutral-500">Missing information</h2>
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
          <h2 className="text-sm font-medium text-neutral-500">Alternatives</h2>
          <ul className="mt-1 space-y-2">
            {decision.alternatives.map((alt, index) => (
              <li key={index} className="text-sm">
                <p className="font-medium text-neutral-800">{alt.title}</p>
                <p className="text-neutral-600">{alt.recommendation}</p>
                {alt.tradeoff && <p className="text-neutral-400">Tradeoff: {alt.tradeoff}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="rounded-xl border border-neutral-100 p-3 text-sm text-neutral-500">
        <summary className="cursor-pointer font-medium text-neutral-600">Technical details</summary>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          <dt className="text-neutral-400">Model</dt>
          <dd>{decision.metadata.modelName}</dd>
          <dt className="text-neutral-400">Provider</dt>
          <dd>{decision.metadata.aiProvider}</dd>
          <dt className="text-neutral-400">Prompt version</dt>
          <dd>{decision.metadata.promptVersion}</dd>
          <dt className="text-neutral-400">Engine schema</dt>
          <dd>v{decision.metadata.engineSchemaVersion}</dd>
          <dt className="text-neutral-400">Decided at</dt>
          <dd>{new Date(decision.metadata.decidedAt).toLocaleString()}</dd>
        </dl>
      </details>
    </Card>
  );
}
