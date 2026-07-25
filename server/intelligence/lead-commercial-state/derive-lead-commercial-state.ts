// Kori's Lead Commercial State engine — the one public entry point.
// Prisma-free, pure: takes a lead's full message history (across every
// conversation) plus a summary of each conversation, and returns a
// LeadCommercialState. No I/O here — server/lead-commercial-state/
// (the thin, Prisma-bound read model) is what loads the inputs this
// function needs.

import type { Evidence, Fact, Inference } from "../types";
import { resolveActiveConversation } from "./active-conversation";
import { NoConversationsForLeadError } from "./errors";
import { foldMutableFieldCandidates } from "./fold-candidates";
import { DEFAULT_SLA_HOURS_BY_NEXT_ACTION, resolveFollowUpDueAt } from "./follow-up-sla";
import { resolveNextAction } from "./next-action-resolver";
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

  const productInterest = toFact(
    foldMutableFieldCandidates(
      dependencies.productInterestExtractors.flatMap((e) => e.extract(messages)),
      activeContext.activeConversationId,
    ),
  );
  const vehicleModel = toFact(
    foldMutableFieldCandidates(
      dependencies.vehicleModelExtractors.flatMap((e) => e.extract(messages)),
      activeContext.activeConversationId,
    ),
  );
  const deliveryLocation = toFact(
    foldMutableFieldCandidates(
      dependencies.locationExtractors.flatMap((e) => e.extract(messages)),
      activeContext.activeConversationId,
    ),
  );
  const requestedDeliveryAt = toFact(
    foldMutableFieldCandidates(
      dependencies.dateExtractors.flatMap((e) => e.extract(messages)),
      activeContext.activeConversationId,
    ),
  );
  const paymentStatus = toInference(
    foldMutableFieldCandidates(
      dependencies.paymentExtractors.flatMap((e) => e.extract(messages)),
      activeContext.activeConversationId,
    ),
  );

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
      slaHoursByNextAction: { ...DEFAULT_SLA_HOURS_BY_NEXT_ACTION, ...slaHoursByNextAction },
      derivedAt: new Date(),
    },
  };
}
