import { Card } from "@/components/ui/Card";
import type { FieldDisplayDTO, LeadCommercialStateDTO } from "@/server/lead-commercial-state/types";

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  NOT_REQUESTED: "Not requested",
  AWAITING_PAYMENT: "Awaiting payment",
  PAYMENT_CONFIRMED: "Payment confirmed",
};

const CONVERSATION_STATE_LABELS: Record<LeadCommercialStateDTO["conversationState"], string> = {
  NEEDS_REPLY: "Needs reply",
  WAITING_ON_CUSTOMER: "Waiting on customer",
  CLOSED: "Closed",
};

const NEXT_ACTION_LABELS: Record<string, string> = {
  ANSWER_QUESTION: "Answer question",
  CONFIRM_PAYMENT: "Confirm payment",
  SCHEDULE_DELIVERY: "Schedule delivery",
  SEND_QUOTE: "Send quote",
  FOLLOW_UP: "Follow up",
  NONE: "No action needed",
};

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
            <summary className="cursor-pointer text-xs text-neutral-400">why?</summary>
            <p className="mt-1 text-xs text-neutral-500">{detail}</p>
          </details>
        )}
      </dd>
    </div>
  );
}

function formatDateTime(iso: string | null): string | null {
  return iso ? new Date(iso).toLocaleString() : null;
}

export function LeadCommercialStateCard({ state }: { state: LeadCommercialStateDTO }) {
  return (
    <Card className="space-y-3" data-testid="lead-commercial-state-card">
      <h2 className="text-sm font-medium text-neutral-500">Commercial state</h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <FieldRow label="Product interest" value={state.productInterest.value} detail={buildDetail(state.productInterest)} />
        <FieldRow label="Vehicle model" value={state.vehicleModel.value} detail={buildDetail(state.vehicleModel)} />
        <FieldRow label="Delivery location" value={state.deliveryLocation.value} detail={buildDetail(state.deliveryLocation)} />
        <FieldRow
          label="Requested delivery"
          value={formatDateTime(state.requestedDeliveryAt.value)}
          detail={buildDetail(state.requestedDeliveryAt)}
        />
        <FieldRow
          label="Payment status"
          value={state.paymentStatus.value ? PAYMENT_STATUS_LABELS[state.paymentStatus.value] : null}
          detail={buildDetail(state.paymentStatus)}
        />
        <FieldRow
          label="Last contact"
          value={`${formatDateTime(state.lastContactAt)} · ${state.lastContactDirection === "OUTBOUND" ? "you" : "customer"}`}
        />
        <FieldRow label="Conversation state" value={CONVERSATION_STATE_LABELS[state.conversationState]} />
        <FieldRow
          label="Next action"
          value={NEXT_ACTION_LABELS[state.nextAction.value ?? "NONE"]}
          detail={buildDetail(state.nextAction)}
        />
        <FieldRow label="Follow-up due" value={formatDateTime(state.followUpDueAt.value)} detail={buildDetail(state.followUpDueAt)} />
      </dl>
    </Card>
  );
}
