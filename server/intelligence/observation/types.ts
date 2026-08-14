// Kori's Observation Engine — public contracts.
//
// Deterministic and Prisma-free, no AIProvider dependency: consumes a single
// DomainEvent (server/domain-events/types.ts) and produces zero or more
// typed Observations. Reuses Evidence from ../types.ts rather than
// reinventing a grounding vocabulary — "observe, don't decide" is a
// structural property here (no reasoning, no confidence score, no AI call),
// not just a prompt instruction. See ARCHITECTURE.md §19.

import type { Evidence } from "../types";

export type ObservationType =
  | "PRICE_REQUEST"
  | "COMPATIBILITY_QUESTION"
  | "INSTALLATION_QUESTION"
  | "CUSTOMER_GHOSTED"
  | "PHOTO_REQUEST"
  | "DISCOUNT_NEGOTIATION"
  // Business intelligence mission — intent signals (see
  // detectors/keyword-detectors.ts). Distinct from the AWAITING_PAYMENT/
  // PAYMENT_CONFIRMED *state* server/intelligence/lead-commercial-state/
  // extractors/payment-extractor.ts tracks — PAYMENT_METHOD_REQUEST is an
  // *event* ("customer asked how to pay"), not a mutable current state.
  | "QUOTE_REQUEST"
  | "AVAILABILITY_REQUEST"
  | "DELIVERY_TIME_REQUEST"
  | "PAYMENT_METHOD_REQUEST"
  // Friction signals — a customer expressing a specific obstacle, not
  // merely asking a neutral question (contrast PRICE_REQUEST above with
  // PRICE_OBJECTION here: "¿cuánto cuesta?" vs "está muy caro").
  | "PRICE_OBJECTION"
  | "AVAILABILITY_FRICTION"
  | "DELIVERY_LOCATION_FRICTION"
  | "INSTALLATION_FRICTION"
  | "TRUST_FRICTION"
  | "TIMING_FRICTION"
  // Geography — coarse Lima-vs-provincia signal, distinct from
  // server/intelligence/lead-commercial-state/extractors/location-extractor.ts's
  // canonical deliveryLocation FACT (a specific place name) — this is a
  // presence signal ("province came up"), not a resolved single value.
  | "LIMA_MENTIONED"
  | "PROVINCE_MENTIONED";

export interface Observation {
  type: ObservationType;
  summary: string;
  evidence: Evidence[];
}

export const OBSERVATION_ENGINE_SCHEMA_VERSION = 1;
