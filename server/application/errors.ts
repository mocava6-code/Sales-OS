// Application-boundary errors and the safe result contract every server
// action returns. Two error families feed into one mapping function:
//  - ApplicationBoundaryError subtypes (auth/authorization/validation
//    failures specific to this boundary — never thrown by the engines or
//    orchestration);
//  - orchestration/engine errors, translated here rather than re-thrown, so
//    nothing internal (stack traces, Prisma errors, provider responses,
//    prompts, secret configuration) ever reaches the browser.

import { AICapabilityNotSupportedError, ModelProviderError } from "../intelligence/errors";
import { CriticalInformationMissingError, DecisionReasoningUnavailableError } from "../intelligence/decision/errors";
import {
  ConversationAnalysisFailedError,
  DecisionGenerationFailedError,
  DecisionNotFoundError,
  InvalidDecisionStatusTransitionError,
  MissingOutcomeAttributionError,
  OrchestrationTransactionError,
  OutcomeNotAllowedForDecisionStatusError,
} from "../orchestration/errors";

export type ApplicationErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "INVALID_TRANSITION"
  | "MISSING_CRITICAL_INFORMATION"
  | "ANALYSIS_IN_PROGRESS"
  | "ORCHESTRATION_FAILURE"
  | "PROVIDER_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface ApplicationError {
  code: ApplicationErrorCode;
  message: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

export type ApplicationResult<T> = { ok: true; data: T } | { ok: false; error: ApplicationError };

export function ok<T>(data: T): ApplicationResult<T> {
  return { ok: true, data };
}

// --- Application-boundary error types -----------------------------------------

export abstract class ApplicationBoundaryError extends Error {
  abstract readonly code: ApplicationErrorCode;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthenticatedError extends ApplicationBoundaryError {
  readonly code = "UNAUTHENTICATED" as const;

  constructor() {
    super("You must be signed in to do that.");
  }
}

export class ForbiddenError extends ApplicationBoundaryError {
  readonly code = "FORBIDDEN" as const;

  constructor(message = "You don't have permission to do that.") {
    super(message);
  }
}

export class NotFoundError extends ApplicationBoundaryError {
  readonly code = "NOT_FOUND" as const;

  constructor(resource: string) {
    super(`${resource} not found.`);
  }
}

export class InvalidInputError extends ApplicationBoundaryError {
  readonly code = "INVALID_INPUT" as const;

  constructor(public readonly fieldErrors: Record<string, string[] | undefined>) {
    super("Please check your input and try again.");
  }
}

export class AnalysisInProgressError extends ApplicationBoundaryError {
  readonly code = "ANALYSIS_IN_PROGRESS" as const;

  constructor() {
    super("This conversation is already being analyzed. Try again in a moment.");
  }
}

// --- Mapping ---------------------------------------------------------------

function isProviderUnavailableCause(cause: unknown): boolean {
  return (
    cause instanceof AICapabilityNotSupportedError ||
    cause instanceof ModelProviderError ||
    cause instanceof DecisionReasoningUnavailableError
  );
}

/** Never returns the raw `.message` of an error we don't recognize — only known, pre-crafted messages ever reach the client. */
export function toApplicationError(error: unknown): ApplicationError {
  if (error instanceof ApplicationBoundaryError) {
    return {
      code: error.code,
      message: error.message,
      fieldErrors: error instanceof InvalidInputError ? error.fieldErrors : undefined,
    };
  }

  if (error instanceof DecisionNotFoundError) {
    return { code: "NOT_FOUND", message: "That decision could not be found." };
  }

  if (error instanceof InvalidDecisionStatusTransitionError) {
    return { code: "INVALID_TRANSITION", message: `This decision can't move from ${error.from} to ${error.to}.` };
  }

  if (error instanceof OutcomeNotAllowedForDecisionStatusError || error instanceof MissingOutcomeAttributionError) {
    return { code: "INVALID_TRANSITION", message: error.message };
  }

  if (error instanceof CriticalInformationMissingError) {
    return {
      code: "MISSING_CRITICAL_INFORMATION",
      message: "There isn't enough information yet to analyze this conversation.",
    };
  }

  if (error instanceof ConversationAnalysisFailedError || error instanceof DecisionGenerationFailedError) {
    return isProviderUnavailableCause(error.cause)
      ? { code: "PROVIDER_UNAVAILABLE", message: "Kori's AI provider is unavailable right now. Try again shortly." }
      : { code: "ORCHESTRATION_FAILURE", message: "Kori couldn't finish analyzing this conversation. Try again shortly." };
  }

  if (error instanceof OrchestrationTransactionError) {
    return { code: "ORCHESTRATION_FAILURE", message: "That action couldn't be completed. Nothing was changed — try again." };
  }

  return { code: "INTERNAL_ERROR", message: "Something went wrong. Try again shortly." };
}

/** Every application handler's outermost boundary — no exception ever escapes uncaught. */
export async function toApplicationResult<T>(run: () => Promise<T>): Promise<ApplicationResult<T>> {
  try {
    return ok(await run());
  } catch (error) {
    return { ok: false, error: toApplicationError(error) };
  }
}
