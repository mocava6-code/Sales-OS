import type { MissingFieldEntry } from "../types";
import type { ApprovalRequirement, DecisionType, ImpactLevel, RiskLevel } from "./types";

// Deterministic company/autonomy policy — no AI involved. This is the one
// place that decides whether a decision may proceed automatically or needs
// a human. The AI never decides this for itself (see DecisionReasoningCapability
// in ../capabilities.ts and the prompt in ./prompts/kori-decision-prompt.ts).

/**
 * Fields whose absence must always require human information, per the phase
 * spec — Kori must not guess any of these regardless of decision type.
 */
const PROTECTED_INFORMATION_CATEGORIES = [
  "price",
  "stock",
  "compatibility",
  "shipping_time",
  "delivery_promise",
  "payment_conditions",
  "discount_authorization",
  "warranty",
  "company_policy",
];

/** Decision types that may be auto-allowed at all — everything else defaults to requiring approval. */
const AUTO_ALLOWED_ELIGIBLE_TYPES: DecisionType[] = [
  "ORGANIZE_CONVERSATION",
  "WAIT",
  "NO_ACTION",
  "ASK_CLARIFYING_QUESTION",
];

export interface PolicyEvaluationInput {
  type: DecisionType;
  riskLevel: RiskLevel;
  impactLevel: ImpactLevel;
  missingInformation: MissingFieldEntry[];
}

export function evaluatePolicy(input: PolicyEvaluationInput): ApprovalRequirement {
  const touchesProtectedCategory = input.missingInformation.some((entry) =>
    PROTECTED_INFORMATION_CATEGORIES.some((category) => entry.field.toLowerCase().includes(category)),
  );

  // Rule 1: missing verified info in a protected category always wins,
  // regardless of type/risk/impact — Kori must not guess.
  if (touchesProtectedCategory) {
    return "HUMAN_INFORMATION_REQUIRED";
  }

  // Rule 2: CRITICAL risk always needs admin-level sign-off.
  if (input.riskLevel === "CRITICAL") {
    return "ADMIN_APPROVAL_REQUIRED";
  }

  // Rule 3: HIGH risk or HIGH impact always needs an advisor to review.
  if (input.riskLevel === "HIGH" || input.impactLevel === "HIGH") {
    return "ADVISOR_APPROVAL_REQUIRED";
  }

  // Rule 4: only a narrow, explicitly low-risk set of decision types may be
  // auto-allowed, and only once everything above has already passed.
  if (AUTO_ALLOWED_ELIGIBLE_TYPES.includes(input.type) && input.riskLevel === "LOW" && input.impactLevel === "LOW") {
    return "AUTO_ALLOWED";
  }

  // Default: never auto-allow anything that hasn't explicitly earned it.
  return "ADVISOR_APPROVAL_REQUIRED";
}
