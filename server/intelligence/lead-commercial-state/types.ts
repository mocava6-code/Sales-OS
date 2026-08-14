// Kori's Lead Commercial State engine — public contracts (Sprint 7).
//
// Reuses Fact<T>/Inference<T>/Evidence from server/intelligence/types.ts
// verbatim rather than reinventing them — the same fact-vs-inference
// discriminant that already prevents a Conversation Intelligence inference
// from being mistaken for a fact applies here unchanged.
//
// Deterministic-first, LLM-fallback-ready: every field is resolved by an
// array of FieldExtractor<T>, run over the *entire* message history. A
// future LLM-backed extractor is just another array entry with the same
// shape — it never replaces the deterministic ones, and the fold rule
// (server/intelligence/lead-commercial-state/fold-candidates.ts, task h)
// means it only wins when a deterministic pass found nothing at the
// relevant precedence tier.

import type { CustomerType, Evidence, Fact, Inference } from "../types";

export type PaymentStatus = "NOT_REQUESTED" | "AWAITING_PAYMENT" | "PAYMENT_CONFIRMED";

/** Mirrors Conversation.status (server/db/schema.prisma) exactly — reused, not re-derived. */
export type ConversationCommercialState = "NEEDS_REPLY" | "WAITING_ON_CUSTOMER" | "CLOSED";

export type NextActionType =
  | "ANSWER_QUESTION"
  | "CONFIRM_PAYMENT"
  | "SCHEDULE_DELIVERY"
  | "SEND_QUOTE"
  | "FOLLOW_UP"
  | "NONE";

// --- Input -------------------------------------------------------------------

/**
 * One ConversationEntry, normalized for extraction. `conversationId` is
 * required (unlike server/intelligence/types.ts's NormalizedMessage) —
 * every extractor needs it to tag its candidates, and the fold step needs
 * it to prefer the active conversation over historical ones (see
 * ActiveConversationContext below).
 */
export interface NormalizedMessageForExtraction {
  id: string;
  conversationId: string;
  direction: "INBOUND" | "OUTBOUND";
  content: string;
  occurredAt: Date;
}

// --- Active conversation context ----------------------------------------------

/** The subset of Conversation's own fields resolveActiveConversation needs — already maintained by appendWhatsAppEntry/markMessageSent, never re-derived here. */
export interface ConversationSummaryForActiveResolution {
  id: string;
  status: ConversationCommercialState;
  lastEntryAt: Date;
  lastEntryDirection: "INBOUND" | "OUTBOUND";
}

/**
 * lastContactAt/lastContactDirection/conversationState come directly from
 * the active conversation's own row — no extraction, no folding, just a
 * read — because those three fields are structurally *about* the active
 * conversation specifically, never a cross-conversation judgment.
 */
export interface ActiveConversationContext {
  activeConversationId: string;
  conversationState: ConversationCommercialState;
  lastContactAt: Date;
  lastContactDirection: "INBOUND" | "OUTBOUND";
}

// --- Extractor contract --------------------------------------------------------

export interface FieldCandidate<T> {
  value: T;
  confidence: number;
  /** Which Conversation this candidate's evidence came from — the fold step's conversation-scope precedence key. */
  conversationId: string;
  /** The evidence message's own timestamp — the fold step's recency tie-break key. */
  occurredAt: Date;
  evidence: Evidence[];
  reasoning?: string;
}

export interface FieldExtractor<T> {
  id: string;
  version: string;
  /** Runs over the *entire* history (all of a lead's conversations) — conversation-scope precedence is applied later, at fold time, not here. */
  extract(messages: NormalizedMessageForExtraction[]): FieldCandidate<T>[];
}

// --- Output --------------------------------------------------------------------

export interface LeadCommercialStateMetadata {
  engineSchemaVersion: number;
  extractorVersions: Record<string, string>;
  /** The operationally-active conversation — most recent activity of any kind. Drives lastContactAt/lastContactDirection/conversationState. */
  activeConversationId: string;
  /**
   * The conversation the mutable commercial fields (product, vehicle,
   * delivery, payment) were scoped to — resolved by commercial-evidence
   * recency, not raw last-entry recency. Usually equal to
   * activeConversationId, but can differ when the active conversation's
   * most recent activity isn't commercial (see resolve-commercial-context.ts).
   */
  commercialContextConversationId: string;
  slaHoursByNextAction: Partial<Record<NextActionType, number>>;
  derivedAt: Date;
}

/**
 * productInterest/vehicleModel/deliveryLocation/requestedDeliveryAt are
 * "mutable" fields (see fold-candidates.ts) — a new, more explicit message
 * in the active conversation can supersede an older one, by design.
 * lastContactAt/lastContactDirection/conversationState are read directly
 * from ActiveConversationContext, never folded across history.
 * followUpDueAt is an Inference, not a Fact — it's a policy computation
 * (which SLA applies), not an observation.
 */
export interface LeadCommercialState {
  productInterest: Fact<string>;
  vehicleModel: Fact<string>;
  /** Kori Data Correctness Phase 1C — deterministic brand inference from the recognized vehicle model (e.g. Hilux -> Toyota); see extractors/freetext-product-extractor.ts's KNOWN_VEHICLE_MODEL_TO_BRAND. */
  vehicleBrand: Fact<string>;
  /** Kori Data Correctness Phase 1C — a 4-digit year token found alongside a recognized vehicle model. */
  vehicleYear: Fact<number>;
  deliveryLocation: Fact<string>;
  requestedDeliveryAt: Fact<Date>;
  paymentStatus: Inference<PaymentStatus>;
  /** Tier-3 deterministic fallback for a field previously 100% dependent on the AI pipeline — see extractors/customer-type-extractor.ts. Mutable, same fold rule as productInterest/vehicleModel: a durable customer trait, not a per-transaction one. */
  customerType: Inference<CustomerType>;
  lastContactAt: Fact<Date>;
  lastContactDirection: Fact<"INBOUND" | "OUTBOUND">;
  conversationState: Fact<ConversationCommercialState>;
  nextAction: Inference<NextActionType>;
  followUpDueAt: Inference<Date>;
  metadata: LeadCommercialStateMetadata;
}

export const LEAD_COMMERCIAL_STATE_ENGINE_SCHEMA_VERSION = 1;
