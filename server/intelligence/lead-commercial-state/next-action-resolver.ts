// Deterministic decision table over already-resolved fields — a
// second-order Inference, never re-extracted from text directly. Each rule
// attaches the evidence of whichever field actually drove the decision, so
// "why CONFIRM_PAYMENT?" always points at something concrete.

import type { Evidence, Fact, Inference } from "../types";
import type { ConversationCommercialState, NextActionType, PaymentStatus } from "./types";

export interface NextActionInput {
  paymentStatus: Inference<PaymentStatus>;
  conversationState: Fact<ConversationCommercialState>;
  productInterest: Fact<string>;
  deliveryLocation: Fact<string>;
  requestedDeliveryAt: Fact<Date>;
}

export interface ResolvedNextAction {
  value: NextActionType;
  reasoning: string;
  evidence: Evidence[];
}

export function resolveNextAction(input: NextActionInput): ResolvedNextAction {
  if (input.paymentStatus.value === "AWAITING_PAYMENT") {
    return {
      value: "CONFIRM_PAYMENT",
      reasoning: "El asesor solicitó el pago y todavía no se observó una confirmación.",
      evidence: input.paymentStatus.evidence,
    };
  }

  if (input.conversationState.value === "NEEDS_REPLY") {
    return {
      value: "ANSWER_QUESTION",
      reasoning: "El último mensaje del cliente todavía no ha sido respondido.",
      evidence: input.conversationState.evidence,
    };
  }

  if (input.paymentStatus.value === "PAYMENT_CONFIRMED" && input.deliveryLocation.value && input.requestedDeliveryAt.value) {
    return {
      value: "SCHEDULE_DELIVERY",
      reasoning: "El pago está confirmado y se conocen tanto el lugar como la fecha/hora de entrega.",
      evidence: [...input.deliveryLocation.evidence, ...input.requestedDeliveryAt.evidence],
    };
  }

  // AWAITING_PAYMENT already returned above, so reaching here means
  // paymentStatus is only ever null, NOT_REQUESTED, or (with no delivery
  // details) PAYMENT_CONFIRMED — all of which still warrant a quote.
  if (input.productInterest.value && input.paymentStatus.value !== "PAYMENT_CONFIRMED") {
    return {
      value: "SEND_QUOTE",
      reasoning: "Se conversó sobre un producto, pero todavía no se inició el proceso de pago.",
      evidence: input.productInterest.evidence,
    };
  }

  if (input.conversationState.value === "WAITING_ON_CUSTOMER") {
    return {
      value: "FOLLOW_UP",
      reasoning: "El asesor está esperando al cliente y no se identificó una acción bloqueante más específica.",
      evidence: input.conversationState.evidence,
    };
  }

  return { value: "NONE", reasoning: "Por ahora no se indica ninguna acción comercial.", evidence: [] };
}
