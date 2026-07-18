import type { DecisionType, ImpactLevel, RiskLevel } from "./types";

// Deterministic risk/impact scoring — no AI involved. Kept intentionally
// simple (a base lookup table + a couple of override conditions) so it's
// easy to read, test, and adjust later as real Koriaki usage reveals
// mistakes in these defaults.

const BASE_RISK_BY_TYPE: Record<DecisionType, RiskLevel> = {
  ORGANIZE_CONVERSATION: "LOW",
  NO_ACTION: "LOW",
  WAIT: "LOW",
  ASK_CLARIFYING_QUESTION: "LOW",
  ESCALATE_TO_HUMAN: "LOW",
  FOLLOW_UP: "MEDIUM",
  WARN_ADVISOR: "LOW",
  RESPOND_TO_CUSTOMER: "MEDIUM",
  RECOMMEND_SALES_APPROACH: "MEDIUM",
};

const BASE_IMPACT_BY_TYPE: Record<DecisionType, ImpactLevel> = {
  ORGANIZE_CONVERSATION: "LOW",
  NO_ACTION: "LOW",
  WAIT: "LOW",
  ASK_CLARIFYING_QUESTION: "LOW",
  ESCALATE_TO_HUMAN: "MEDIUM",
  FOLLOW_UP: "MEDIUM",
  WARN_ADVISOR: "MEDIUM",
  RESPOND_TO_CUSTOMER: "MEDIUM",
  // Explicitly called out in the phase spec as high-impact: a change in
  // sales strategy always starts at HIGH impact, never LOW/MEDIUM.
  RECOMMEND_SALES_APPROACH: "HIGH",
};

export interface RiskEvaluationInput {
  type: DecisionType;
  /** Whether validation found an ungrounded claim in a protected category (price, stock, compatibility, ...). */
  hasUngroundedProtectedClaim: boolean;
  /** Whether the text suggests discounting, pressure tactics, or an explicit promise. */
  hasCommerciallyRiskyFraming: boolean;
}

export interface RiskEvaluation {
  riskLevel: RiskLevel;
  impactLevel: ImpactLevel;
}

export function evaluateRisk(input: RiskEvaluationInput): RiskEvaluation {
  let riskLevel = BASE_RISK_BY_TYPE[input.type];
  let impactLevel = BASE_IMPACT_BY_TYPE[input.type];

  // An ungrounded claim in a protected category (price/stock/compatibility/...)
  // is exactly the "communicating uncertain compatibility" / "making
  // promises" scenario the phase spec calls out as high-impact — escalate
  // regardless of the decision's base type.
  if (input.hasUngroundedProtectedClaim) {
    riskLevel = "HIGH";
    impactLevel = "HIGH";
  }

  // Discounting, pressure, or an explicit promise is high-impact by nature,
  // whether or not it's grounded — these are commercial-strategy risks, not
  // grounding risks.
  if (input.hasCommerciallyRiskyFraming) {
    riskLevel = maxRisk(riskLevel, "HIGH");
    impactLevel = maxImpact(impactLevel, "HIGH");
  }

  return { riskLevel, impactLevel };
}

const RISK_ORDER: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const IMPACT_ORDER: ImpactLevel[] = ["LOW", "MEDIUM", "HIGH"];

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

function maxImpact(a: ImpactLevel, b: ImpactLevel): ImpactLevel {
  return IMPACT_ORDER.indexOf(a) >= IMPACT_ORDER.indexOf(b) ? a : b;
}
