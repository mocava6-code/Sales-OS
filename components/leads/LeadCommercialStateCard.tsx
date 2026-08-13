import { Card } from "@/components/ui/Card";
import type { FieldDisplayDTO, LeadCommercialStateDTO } from "@/server/lead-commercial-state/types";
import { formatDateTime } from "@/lib/copy/format";
import { CONVERSATION_STATUS_LABELS, NEXT_ACTION_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/copy/labels";

/** The "confidence/evidence affordance" — reasoning when present, otherwise the raw message excerpt that grounds the value, otherwise nothing to show. */
function buildDetail(field: Pick<FieldDisplayDTO<unknown>, "reasoning" | "evidenceExcerpt">): string | null {
  if (field.reasoning) return field.reasoning;
  if (field.evidenceExcerpt) return `"${field.evidenceExcerpt}"`;
  return null;
}

function FieldRow({ label, value, detail }: { label: string; value: string | null; detail?: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium text-neutral-400">{label}</dt>
      <dd className="text-neutral-900">
        {value ?? <span className="text-neutral-300">—</span>}
        {detail && (
          <details className="mt-0.5">
            <summary className="cursor-pointer text-xs text-neutral-400">¿por qué?</summary>
            <p className="mt-1 text-xs text-neutral-500">{detail}</p>
          </details>
        )}
      </dd>
    </div>
  );
}

function formatIsoDateTime(iso: string | null): string | null {
  return iso ? formatDateTime(new Date(iso)) : null;
}

export function LeadCommercialStateCard({ state }: { state: LeadCommercialStateDTO }) {
  return (
    <Card className="space-y-3" data-testid="lead-commercial-state-card">
      <h2 className="text-sm font-medium text-neutral-500">Estado comercial</h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <FieldRow label="Producto de interés" value={state.productInterest.value} detail={buildDetail(state.productInterest)} />
        <FieldRow label="Modelo del vehículo" value={state.vehicleModel.value} detail={buildDetail(state.vehicleModel)} />
        <FieldRow label="Lugar de entrega" value={state.deliveryLocation.value} detail={buildDetail(state.deliveryLocation)} />
        <FieldRow
          label="Entrega solicitada"
          value={formatIsoDateTime(state.requestedDeliveryAt.value)}
          detail={buildDetail(state.requestedDeliveryAt)}
        />
        <FieldRow
          label="Estado de pago"
          value={state.paymentStatus.value ? PAYMENT_STATUS_LABELS[state.paymentStatus.value] : null}
          detail={buildDetail(state.paymentStatus)}
        />
        <FieldRow
          label="Último contacto"
          value={`${formatIsoDateTime(state.lastContactAt)} · ${state.lastContactDirection === "OUTBOUND" ? "tú" : "cliente"}`}
        />
        <FieldRow label="Estado de la conversación" value={CONVERSATION_STATUS_LABELS[state.conversationState]} />
        <FieldRow
          label="Próxima acción"
          value={NEXT_ACTION_LABELS[state.nextAction.value ?? "NONE"]}
          detail={buildDetail(state.nextAction)}
        />
        <FieldRow label="Seguimiento vence" value={formatIsoDateTime(state.followUpDueAt.value)} detail={buildDetail(state.followUpDueAt)} />
      </dl>
    </Card>
  );
}
