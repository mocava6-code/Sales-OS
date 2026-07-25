import type { Fact, Inference } from "../intelligence/types";
import type { LeadCommercialState } from "../intelligence/lead-commercial-state/types";
import type { FieldDisplayDTO, LeadCommercialStateDTO } from "./types";

function toFieldDisplayDTO<T, S>(field: Fact<T> | Inference<T>, serialize: (value: T) => S): FieldDisplayDTO<S> {
  return {
    value: field.value === null ? null : serialize(field.value),
    confidence: field.confidence,
    evidenceExcerpt: field.evidence[0]?.excerpt ?? null,
    reasoning: "reasoning" in field ? (field.reasoning ?? null) : null,
  };
}

const identity = <T extends string | number | boolean>(value: T) => value;
const toIso = (value: Date) => value.toISOString();

export function toLeadCommercialStateDTO(state: LeadCommercialState): LeadCommercialStateDTO {
  return {
    productInterest: toFieldDisplayDTO(state.productInterest, identity),
    vehicleModel: toFieldDisplayDTO(state.vehicleModel, identity),
    deliveryLocation: toFieldDisplayDTO(state.deliveryLocation, identity),
    requestedDeliveryAt: toFieldDisplayDTO(state.requestedDeliveryAt, toIso),
    paymentStatus: toFieldDisplayDTO(state.paymentStatus, identity),
    lastContactAt: (state.lastContactAt.value as Date).toISOString(),
    lastContactDirection: state.lastContactDirection.value as "INBOUND" | "OUTBOUND",
    conversationState: state.conversationState.value as LeadCommercialStateDTO["conversationState"],
    nextAction: toFieldDisplayDTO(state.nextAction, identity),
    followUpDueAt: toFieldDisplayDTO(state.followUpDueAt, toIso),
    activeConversationId: state.metadata.activeConversationId,
    derivedAt: state.metadata.derivedAt.toISOString(),
  };
}
