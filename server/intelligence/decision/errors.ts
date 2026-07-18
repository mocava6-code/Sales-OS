// Decision Engine errors. Extends the same base class as the Conversation
// Intelligence Engine's errors (server/intelligence/errors.ts) so both
// engines share one error convention (a `.code`, `instanceof`-checkable).
// AI-call failures and generic "engine assembled something invalid"
// failures reuse ModelProviderError / EngineInternalError directly from
// ../errors rather than duplicating them here — only what's genuinely new
// to decision-making gets a new class.

import { ConversationIntelligenceError } from "../errors";

export class DecisionReasoningUnavailableError extends ConversationIntelligenceError {
  readonly code = "DECISION_REASONING_UNAVAILABLE";

  constructor(providerName: string) {
    super(`AI provider "${providerName}" does not support the "decisionReasoning" capability.`);
  }
}

export class InvalidDecisionOutputError extends ConversationIntelligenceError {
  readonly code = "INVALID_DECISION_OUTPUT";

  constructor(
    message: string,
    public readonly issues?: unknown,
  ) {
    super(message);
  }
}

/**
 * Thrown internally when a decision proposal makes a concrete, unsupported
 * claim in a protected category (price, stock, compatibility, etc.) with no
 * grounding evidence. Never escapes the pipeline — it's caught immediately
 * and converted into an ESCALATE_TO_HUMAN decision (see ./validator.ts and
 * ./pipeline.ts), never a silent drop.
 */
export class UnsupportedDecisionClaimError extends ConversationIntelligenceError {
  readonly code = "UNSUPPORTED_DECISION_CLAIM";

  constructor(
    public readonly category: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Thrown before any AI call when the supplied KoriDecisionContext has no
 * usable signal at all (no conversationIntelligence, no recentMessages, no
 * conversationSummary) — there is nothing to reason about yet.
 */
export class CriticalInformationMissingError extends ConversationIntelligenceError {
  readonly code = "CRITICAL_INFORMATION_MISSING";

  constructor(message: string) {
    super(message);
  }
}
