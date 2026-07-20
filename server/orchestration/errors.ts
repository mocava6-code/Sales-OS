// Orchestration errors. Mirrors the shape/convention of
// server/intelligence/errors.ts (an abstract base with a `.code`,
// `instanceof`-checkable, `name = new.target.name`) rather than extending
// ConversationIntelligenceError directly — orchestration errors span
// coordination and persistence failures that aren't conversation-intelligence
// errors themselves (e.g. DecisionNotFoundError), so inheriting that class
// would misrepresent what they are. Errors thrown by the engines
// (ModelProviderError, InvalidDecisionOutputError, etc.) are still surfaced
// via `.cause` on ConversationAnalysisFailedError / DecisionGenerationFailedError
// rather than re-typed — nothing about them changes, they're just wrapped.

export abstract class OrchestrationError extends Error {
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The Conversation Intelligence Engine call failed. See `.cause` for the original engine error. */
export class ConversationAnalysisFailedError extends OrchestrationError {
  readonly code = "CONVERSATION_ANALYSIS_FAILED";

  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

/** The Decision Engine call failed. See `.cause` for the original engine error. */
export class DecisionGenerationFailedError extends OrchestrationError {
  readonly code = "DECISION_GENERATION_FAILED";

  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

/**
 * A workflow's transaction failed and every write it attempted was rolled
 * back — no partial memory was left behind. See `.cause` for the underlying
 * failure. Never thrown for OrchestrationError subtypes raised deliberately
 * inside a transaction (e.g. DecisionNotFoundError) — those propagate as
 * themselves; see server/orchestration/transaction.ts.
 */
export class OrchestrationTransactionError extends OrchestrationError {
  readonly code = "ORCHESTRATION_TRANSACTION_FAILED";

  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

export class DecisionNotFoundError extends OrchestrationError {
  readonly code = "DECISION_NOT_FOUND";

  constructor(public readonly decisionRecordId: string) {
    super(`No DecisionRecord found with id "${decisionRecordId}".`);
  }
}

export class InvalidDecisionStatusTransitionError extends OrchestrationError {
  readonly code = "INVALID_DECISION_STATUS_TRANSITION";

  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Cannot transition a decision from "${from}" to "${to}".`);
  }
}

/**
 * A REJECTED/OVERRIDDEN/CANCELLED decision received an outcome that (implicitly
 * or explicitly) claims Kori's recommendation was followed — see
 * ./outcome-attribution-policy.ts.
 */
export class OutcomeNotAllowedForDecisionStatusError extends OrchestrationError {
  readonly code = "OUTCOME_NOT_ALLOWED_FOR_DECISION_STATUS";

  constructor(
    public readonly decisionStatus: string,
    public readonly outcomeType: string,
  ) {
    super(
      `A decision with status "${decisionStatus}" cannot receive a "${outcomeType}" outcome attributed to ` +
        `KORI_RECOMMENDATION (or left unattributed) — that decision's recommendation was never executed. ` +
        `Attribute the outcome to ADVISOR_ALTERNATIVE or UNATTRIBUTED instead.`,
    );
  }
}

/** SALE_CLOSED and SALE_LOST outcomes must always carry an explicit attribution — see ./outcome-attribution-policy.ts. */
export class MissingOutcomeAttributionError extends OrchestrationError {
  readonly code = "MISSING_OUTCOME_ATTRIBUTION";

  constructor(public readonly outcomeType: string) {
    super(
      `"${outcomeType}" outcomes must specify an attribution ` +
        `(KORI_RECOMMENDATION, ADVISOR_ALTERNATIVE, or UNATTRIBUTED).`,
    );
  }
}
