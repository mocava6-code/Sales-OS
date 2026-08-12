// Kori's Lead Commercial State engine — the one public entry point.
// Prisma-free, pure: takes a lead's full message history (across every
// conversation) plus a summary of each conversation, and returns a
// LeadCommercialState. No I/O here — server/lead-commercial-state/
// (the thin, Prisma-bound read model) is what loads the inputs this
// function needs.

import type { Evidence, Fact, Inference } from "../types";
import { resolveActiveConversation } from "./active-conversation";
import { NoConversationsForLeadError } from "./errors";
import { foldMutableFieldCandidates, foldTransientFieldCandidates } from "./fold-candidates";
import { DEFAULT_SLA_HOURS_BY_NEXT_ACTION, resolveFollowUpDueAt } from "./follow-up-sla";
import { resolveNextAction } from "./next-action-resolver";
import { resolveCommercialContextConversationId } from "./resolve-commercial-context";
import { resolveConversationFacts } from "./resolve-conversation-facts";
import {
  LEAD_COMMERCIAL_STATE_ENGINE_SCHEMA_VERSION,
  type ActiveConversationContext,
  type ConversationSummaryForActiveResolution,
  type FieldExtractor,
  type LeadCommercialState,
  type NextActionType,
  type NormalizedMessageForExtraction,
  type PaymentStatus,
} from "./types";

export interface LeadCommercialStateDependencies {
  productInterestExtractors: FieldExtractor<string>[];
  vehicleModelExtractors: FieldExtractor<string>[];
  /** Kori Data Correctness Phase 1C. */
  vehicleBrandExtractors: FieldExtractor<string>[];
  /** Kori Data Correctness Phase 1C. */
  vehicleYearExtractors: FieldExtractor<number>[];
  locationExtractors: FieldExtractor<string>[];
  dateExtractors: FieldExtractor<Date>[];
  paymentExtractors: FieldExtractor<PaymentStatus>[];
  /** Overrides DEFAULT_SLA_HOURS_BY_NEXT_ACTION per action type; unset entries fall back to the default. */
  slaHoursByNextAction?: Partial<Record<NextActionType, number>>;
}

function toFact<T>(folded: { value: T; confidence: number; evidence: Evidence[] } | null): Fact<T> {
  if (!folded) return { kind: "fact", value: null, confidence: 0, evidence: [] };
  return { kind: "fact", value: folded.value, confidence: folded.confidence, evidence: folded.evidence };
}

function toInference<T>(folded: { value: T; confidence: number; evidence: Evidence[]; reasoning?: string } | null): Inference<T> {
  if (!folded) return { kind: "inference", value: null, confidence: 0, evidence: [] };
  return { kind: "inference", value: folded.value, confidence: folded.confidence, evidence: folded.evidence, reasoning: folded.reasoning };
}

function buildExtractorVersionMap(dependencies: LeadCommercialStateDependencies): Record<string, string> {
  const all = [
    ...dependencies.productInterestExtractors,
    ...dependencies.vehicleModelExtractors,
    ...dependencies.vehicleBrandExtractors,
    ...dependencies.vehicleYearExtractors,
    ...dependencies.locationExtractors,
    ...dependencies.dateExtractors,
    ...dependencies.paymentExtractors,
  ];
  return Object.fromEntries(all.map((extractor) => [extractor.id, extractor.version]));
}

export function deriveLeadCommercialState(
  leadId: string,
  messages: NormalizedMessageForExtraction[],
  conversations: ConversationSummaryForActiveResolution[],
  dependencies: LeadCommercialStateDependencies,
): LeadCommercialState {
  const activeConversation = resolveActiveConversation(conversations);
  if (!activeConversation) {
    throw new NoConversationsForLeadError(leadId);
  }

  const activeContext: ActiveConversationContext = {
    activeConversationId: activeConversation.id,
    conversationState: activeConversation.status,
    lastContactAt: activeConversation.lastEntryAt,
    lastContactDirection: activeConversation.lastEntryDirection,
  };

  const conversationFacts = resolveConversationFacts(activeContext);

  const productInterestCandidates = dependencies.productInterestExtractors.flatMap((e) => e.extract(messages));
  const vehicleModelCandidates = dependencies.vehicleModelExtractors.flatMap((e) => e.extract(messages));
  const vehicleBrandCandidates = dependencies.vehicleBrandExtractors.flatMap((e) => e.extract(messages));
  const vehicleYearCandidates = dependencies.vehicleYearExtractors.flatMap((e) => e.extract(messages));
  const locationCandidates = dependencies.locationExtractors.flatMap((e) => e.extract(messages));
  const dateCandidates = dependencies.dateExtractors.flatMap((e) => e.extract(messages));
  const paymentCandidates = dependencies.paymentExtractors.flatMap((e) => e.extract(messages));

  const commercialContextConversationId = resolveCommercialContextConversationId(
    [
      ...productInterestCandidates,
      ...vehicleModelCandidates,
      ...vehicleBrandCandidates,
      ...vehicleYearCandidates,
      ...locationCandidates,
      ...dateCandidates,
      ...paymentCandidates,
    ],
    conversations,
    activeContext.activeConversationId,
  );

  const productInterest = toFact(foldMutableFieldCandidates(productInterestCandidates, commercialContextConversationId));
  const vehicleModel = toFact(foldMutableFieldCandidates(vehicleModelCandidates, commercialContextConversationId));
  const vehicleBrand = toFact(foldMutableFieldCandidates(vehicleBrandCandidates, commercialContextConversationId));
  const vehicleYear = toFact(foldMutableFieldCandidates(vehicleYearCandidates, commercialContextConversationId));
  const deliveryLocation = toFact(foldMutableFieldCandidates(locationCandidates, commercialContextConversationId));
  // paymentStatus/requestedDeliveryAt are transient (see fold-candidates.ts)
  // — scoped to the commercial-context conversation only, no cross-
  // conversation historical fallback.
  const requestedDeliveryAt = toFact(foldTransientFieldCandidates(dateCandidates, commercialContextConversationId));
  const paymentStatus = toInference(foldTransientFieldCandidates(paymentCandidates, commercialContextConversationId));

  const nextActionResolution = resolveNextAction({
    paymentStatus,
    conversationState: conversationFacts.conversationState,
    productInterest,
    deliveryLocation,
    requestedDeliveryAt,
  });

  const nextAction: Inference<NextActionType> = {
    kind: "inference",
    value: nextActionResolution.value,
    confidence: 1,
    evidence: nextActionResolution.evidence,
    reasoning: nextActionResolution.reasoning,
  };

  const slaHoursByNextAction = dependencies.slaHoursByNextAction ?? {};
  const followUpDueAt = resolveFollowUpDueAt(
    conversationFacts.lastContactAt.value as Date,
    nextActionResolution.value,
    activeContext.activeConversationId,
    slaHoursByNextAction,
  );

  return {
    productInterest,
    vehicleModel,
    vehicleBrand,
    vehicleYear,
    deliveryLocation,
    requestedDeliveryAt,
    paymentStatus,
    lastContactAt: conversationFacts.lastContactAt,
    lastContactDirection: conversationFacts.lastContactDirection,
    conversationState: conversationFacts.conversationState,
    nextAction,
    followUpDueAt,
    metadata: {
      engineSchemaVersion: LEAD_COMMERCIAL_STATE_ENGINE_SCHEMA_VERSION,
      extractorVersions: buildExtractorVersionMap(dependencies),
      activeConversationId: activeContext.activeConversationId,
      commercialContextConversationId,
      slaHoursByNextAction: { ...DEFAULT_SLA_HOURS_BY_NEXT_ACTION, ...slaHoursByNextAction },
      derivedAt: new Date(),
    },
  };
}
