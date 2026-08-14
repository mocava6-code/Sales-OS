// Turns LeadCommercialProfile's EXISTING provenance data (source +
// confidence — see lead-commercial-profile-service.ts) into the
// explicit/contextual/unresolved taxonomy the product needs, without any
// new schema: no persisted "classification" field, nothing that could
// drift out of sync with the value it describes.
//
// - CONFIRMED: a literal, unambiguous customer statement — either the
//   deterministic tier-3 extractor (server/intelligence/lead-commercial-
//   state/extractors/customer-type-extractor.ts, which only ever fires on
//   an exact "cliente final"/"distribuidor"-class phrase), or an AI (tier
//   2) classification confident enough to represent the SAME kind of
//   explicit self-identification (see the prompt's own rule 5a distinction
//   between an explicit statement, 0.85+, and contextual evidence, below
//   that).
// - INFERRED: an AI (tier 2) contextual judgment below that bar — grounded
//   and evidenced, but a reasoned inference from context (e.g. "tengo un
//   taller y compro para revender"), not a literal self-identification.
// - INSUFFICIENT_EVIDENCE: customerType is null — Kori genuinely has
//   nothing to go on yet, not a system failure.

import type { CustomerTypeProfile } from "@/server/db/generated/client";
import type { FieldProvenance } from "./lead-commercial-profile-service";

export type CustomerTypeClassification = "CONFIRMED" | "INFERRED" | "INSUFFICIENT_EVIDENCE";

/**
 * Confidence bar an AI (tier-2) customerType candidate must clear to count
 * as CONFIRMED rather than INFERRED. Matches kori-conversation-analysis-
 * prompt.ts rule 5a's own distinction between an explicit self-
 * identification (0.85+) and strong contextual evidence (moderate-to-high,
 * below that) — kept as one named constant so the prompt guidance and this
 * classification never drift apart silently.
 */
export const AI_EXPLICIT_CUSTOMER_TYPE_CONFIDENCE_THRESHOLD = 0.85;

export function classifyCustomerType(
  customerType: CustomerTypeProfile | null,
  provenance: FieldProvenance | undefined,
): CustomerTypeClassification {
  if (customerType === null || !provenance) return "INSUFFICIENT_EVIDENCE";

  switch (provenance.source) {
    case "LEAD_COMMERCIAL_STATE":
      return "CONFIRMED";
    case "EXISTING": // a human-entered/overridden value — not reachable today, but maximally trustworthy when it is
      return "CONFIRMED";
    case "CONVERSATION_SNAPSHOT":
      return (provenance.confidence ?? 0) >= AI_EXPLICIT_CUSTOMER_TYPE_CONFIDENCE_THRESHOLD ? "CONFIRMED" : "INFERRED";
  }
}
