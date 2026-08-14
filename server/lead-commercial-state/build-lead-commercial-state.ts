// The thin, Prisma-bound read model — mirrors server/observer-console/'s
// split (pure engine vs. thin loader), but deliberately does NOT follow its
// stricter "provably Prisma-free, import-scan guardrail" discipline: this
// package is the loader by design, the same way server/orchestration/**
// is the one place allowed to bind server/intelligence/**'s pure engines to
// real persistence. server/intelligence/lead-commercial-state/** stays
// Prisma-free; this file is what's allowed to touch Prisma-shaped input.

import {
  deriveLeadCommercialState,
  type LeadCommercialStateDependencies,
} from "../intelligence/lead-commercial-state/derive-lead-commercial-state";
import {
  productInterestExtractor,
  vehicleBrandExtractor,
  vehicleModelExtractor,
  vehicleYearExtractor,
} from "../intelligence/lead-commercial-state/extractors/freetext-product-extractor";
import { customerTypeExtractor } from "../intelligence/lead-commercial-state/extractors/customer-type-extractor";
import { deliveryLocationExtractor } from "../intelligence/lead-commercial-state/extractors/location-extractor";
import { paymentStatusExtractor } from "../intelligence/lead-commercial-state/extractors/payment-extractor";
import { createRequestedDeliveryAtExtractor } from "../intelligence/lead-commercial-state/extractors/relative-date-extractor";
import type { ConversationSummaryForActiveResolution, NormalizedMessageForExtraction } from "../intelligence/lead-commercial-state/types";
import { toLeadCommercialStateDTO } from "./to-dto";
import type { LeadCommercialStateDTO } from "./types";

export interface ConversationEntryForCommercialState {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  content: string;
  occurredAt: Date;
}

export interface ConversationForCommercialState {
  id: string;
  status: "NEEDS_REPLY" | "WAITING_ON_CUSTOMER" | "CLOSED";
  lastEntryAt: Date;
  lastEntryDirection: "INBOUND" | "OUTBOUND";
  entries: ConversationEntryForCommercialState[];
}

/**
 * Structural, not a literal import of getLead's return type — decouples
 * this module from server/services/lead-service.ts's exact query shape.
 * Prisma's real result satisfies this interface structurally.
 */
export interface LeadForCommercialState {
  id: string;
  conversations: ConversationForCommercialState[];
}

function buildDefaultDependencies(businessTimezone: string): LeadCommercialStateDependencies {
  return {
    productInterestExtractors: [productInterestExtractor],
    vehicleModelExtractors: [vehicleModelExtractor],
    vehicleBrandExtractors: [vehicleBrandExtractor],
    vehicleYearExtractors: [vehicleYearExtractor],
    locationExtractors: [deliveryLocationExtractor],
    dateExtractors: [createRequestedDeliveryAtExtractor(businessTimezone)],
    paymentExtractors: [paymentStatusExtractor],
    customerTypeExtractors: [customerTypeExtractor],
  };
}

/**
 * Builds a Lead's commercial state from an already-loaded Lead (with its
 * conversations and entries — see server/services/lead-service.ts's
 * getLead, which already fetches exactly this shape for the Lead page; no
 * second conversations/entries query is issued here).
 */
export function buildLeadCommercialState(lead: LeadForCommercialState, businessTimezone: string): LeadCommercialStateDTO {
  const messages: NormalizedMessageForExtraction[] = lead.conversations.flatMap((conversation) =>
    conversation.entries.map((entry) => ({
      id: entry.id,
      conversationId: conversation.id,
      direction: entry.direction,
      content: entry.content,
      occurredAt: entry.occurredAt,
    })),
  );

  const conversationSummaries: ConversationSummaryForActiveResolution[] = lead.conversations.map((conversation) => ({
    id: conversation.id,
    status: conversation.status,
    lastEntryAt: conversation.lastEntryAt,
    lastEntryDirection: conversation.lastEntryDirection,
  }));

  const state = deriveLeadCommercialState(lead.id, messages, conversationSummaries, buildDefaultDependencies(businessTimezone));

  return toLeadCommercialStateDTO(state);
}
