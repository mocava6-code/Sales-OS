// Deterministic outcome/status consistency validation — the single source
// of truth for whether an outcome may be recorded against a decision in a
// given status, and whether that outcome's attribution is well-formed.
// Consulted by ./outcome-workflows.ts before every uow.outcomes.record call.
//
// Rules (Kori Application Integration v1, preliminary domain correction 2):
// - REJECTED, OVERRIDDEN, and CANCELLED decisions never received an executed
//   recommendation — an outcome against one of them may not claim
//   KORI_RECOMMENDATION (or omit attribution, which defaults to reading as
//   "the recommendation happened"). It must explicitly say what actually
//   produced it: ADVISOR_ALTERNATIVE (an override, or the advisor's own
//   alternative action) or UNATTRIBUTED (general conversation history
//   unrelated to executing Kori's recommendation).
// - EXECUTED and APPROVED decisions may receive outcomes with any
//   attribution, including none — Kori's recommendation is plausibly what's
//   playing out, so no extra justification is required.
// - PROPOSED is intentionally not restricted here — nothing in this phase's
//   spec names it, and conversation reality (e.g. the customer replying)
//   doesn't wait for an advisor to click "approve."
// - SALE_CLOSED and SALE_LOST must always carry an explicit attribution,
//   regardless of decision status — these are the two outcomes a future
//   Learning Engine will care about most, so they never get to be silent.

import type { DecisionStatus } from "../intelligence/decision/types";
import type { OutcomeAttribution, OutcomeType } from "../persistence/types";
import { MissingOutcomeAttributionError, OutcomeNotAllowedForDecisionStatusError } from "./errors";

const STATUSES_REQUIRING_EXPLICIT_NON_KORI_ATTRIBUTION: ReadonlySet<DecisionStatus> = new Set([
  "REJECTED",
  "OVERRIDDEN",
  "CANCELLED",
]);

const OUTCOME_TYPES_REQUIRING_ATTRIBUTION: ReadonlySet<OutcomeType> = new Set(["SALE_CLOSED", "SALE_LOST"]);

export function assertOutcomeRecordable(
  decisionStatus: DecisionStatus,
  outcomeType: OutcomeType,
  attribution: OutcomeAttribution | undefined,
): void {
  if (STATUSES_REQUIRING_EXPLICIT_NON_KORI_ATTRIBUTION.has(decisionStatus)) {
    if (!attribution || attribution === "KORI_RECOMMENDATION") {
      throw new OutcomeNotAllowedForDecisionStatusError(decisionStatus, outcomeType);
    }
  }

  if (OUTCOME_TYPES_REQUIRING_ATTRIBUTION.has(outcomeType) && !attribution) {
    throw new MissingOutcomeAttributionError(outcomeType);
  }
}
