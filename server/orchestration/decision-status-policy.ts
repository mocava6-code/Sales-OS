// A small, deterministic status-transition policy — the single source of
// truth for which DecisionRecord.status transitions are legal. Every
// workflow in ./decision-workflows.ts consults this instead of hardcoding
// its own rule, so the allowed graph is defined exactly once.
//
// PROPOSED --> APPROVED    (approveDecision)
// PROPOSED --> REJECTED    (rejectDecision)
// PROPOSED --> OVERRIDDEN  (recordAdvisorOverride, before approval)
// APPROVED --> EXECUTED    (executeDecision)
// APPROVED --> REJECTED    (rejectDecision, advisor reverses before executing)
// APPROVED --> OVERRIDDEN  (recordAdvisorOverride, after approval but before executing)
// REJECTED, EXECUTED, CANCELLED, OVERRIDDEN are terminal — nothing transitions
// out of them. No workflow in this phase ever sets CANCELLED; it stays
// terminal-only. OVERRIDDEN and REJECTED are distinct terminal states — see
// the DecisionStatus doc comment in server/intelligence/decision/types.ts.

import type { DecisionStatus } from "../intelligence/decision/types";
import { InvalidDecisionStatusTransitionError } from "./errors";

const ALLOWED_TRANSITIONS: Readonly<Record<DecisionStatus, readonly DecisionStatus[]>> = {
  PROPOSED: ["APPROVED", "REJECTED", "OVERRIDDEN"],
  APPROVED: ["EXECUTED", "REJECTED", "OVERRIDDEN"],
  REJECTED: [],
  EXECUTED: [],
  CANCELLED: [],
  OVERRIDDEN: [],
};

export function isDecisionStatusTransitionAllowed(from: DecisionStatus, to: DecisionStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertDecisionStatusTransitionAllowed(from: DecisionStatus, to: DecisionStatus): void {
  if (!isDecisionStatusTransitionAllowed(from, to)) {
    throw new InvalidDecisionStatusTransitionError(from, to);
  }
}
