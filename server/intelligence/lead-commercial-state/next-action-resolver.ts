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
      reasoning: "The advisor requested payment and no confirmation has been observed yet.",
      evidence: input.paymentStatus.evidence,
    };
  }

  if (input.conversationState.value === "NEEDS_REPLY") {
    return {
      value: "ANSWER_QUESTION",
      reasoning: "The customer's last message has not been answered yet.",
      evidence: input.conversationState.evidence,
    };
  }

  if (input.paymentStatus.value === "PAYMENT_CONFIRMED" && input.deliveryLocation.value && input.requestedDeliveryAt.value) {
    return {
      value: "SCHEDULE_DELIVERY",
      reasoning: "Payment is confirmed and both a delivery location and date/time are known.",
      evidence: [...input.deliveryLocation.evidence, ...input.requestedDeliveryAt.evidence],
    };
  }

  // AWAITING_PAYMENT already returned above, so reaching here means
  // paymentStatus is only ever null, NOT_REQUESTED, or (with no delivery
  // details) PAYMENT_CONFIRMED — all of which still warrant a quote.
  if (input.productInterest.value && input.paymentStatus.value !== "PAYMENT_CONFIRMED") {
    return {
      value: "SEND_QUOTE",
      reasoning: "A product has been discussed but no payment step has started yet.",
      evidence: input.productInterest.evidence,
    };
  }

  if (input.conversationState.value === "WAITING_ON_CUSTOMER") {
    return {
      value: "FOLLOW_UP",
      reasoning: "The advisor is waiting on the customer with no more specific blocking action identified.",
      evidence: input.conversationState.evidence,
    };
  }

  return { value: "NONE", reasoning: "No commercial action is currently indicated.", evidence: [] };
}
