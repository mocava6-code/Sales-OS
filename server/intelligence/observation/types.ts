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
  | "DISCOUNT_NEGOTIATION";

export interface Observation {
  type: ObservationType;
  summary: string;
  evidence: Evidence[];
}

export const OBSERVATION_ENGINE_SCHEMA_VERSION = 1;
