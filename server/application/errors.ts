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
import { InvalidCandidateStatusTransitionError, KnowledgeCandidateNotFoundError } from "../knowledge/errors";
import {
  ConversationAnalysisFailedError,
  DecisionGenerationFailedError,
  DecisionNotFoundError,
  InvalidDecisionStatusTransitionError,
  MissingOutcomeAttributionError,
  OrchestrationTransactionError,
  OutcomeNotAllowedForDecisionStatusError,
} from "../orchestration/errors";
import {
  InvalidKoriQuerySpecError,
  KoriAIConfigurationError,
  KoriNaturalLanguageParseError,
  KoriProviderRateLimitedError,
  UnsupportedKoriQuestionError,
} from "../kori/errors";

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
  | "UNSUPPORTED_QUESTION"
  | "RATE_LIMITED"
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
    super("Debes iniciar sesión para hacer eso.");
  }
}

export class ForbiddenError extends ApplicationBoundaryError {
  readonly code = "FORBIDDEN" as const;

  constructor(message = "Tu sesión no tiene acceso a esta función.") {
    super(message);
  }
}

export class NotFoundError extends ApplicationBoundaryError {
  readonly code = "NOT_FOUND" as const;

  constructor(resource: string) {
    super(`No encontramos ${resource}.`);
  }
}

export class InvalidInputError extends ApplicationBoundaryError {
  readonly code = "INVALID_INPUT" as const;

  constructor(public readonly fieldErrors: Record<string, string[] | undefined>) {
    super("Revisa los datos ingresados e inténtalo de nuevo.");
  }
}

export class AnalysisInProgressError extends ApplicationBoundaryError {
  readonly code = "ANALYSIS_IN_PROGRESS" as const;

  constructor() {
    super("Esta conversación ya se está analizando. Inténtalo de nuevo en un momento.");
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
    return { code: "NOT_FOUND", message: "No encontramos esa decisión." };
  }

  if (error instanceof InvalidDecisionStatusTransitionError) {
    return { code: "INVALID_TRANSITION", message: `Esta decisión no puede pasar de ${error.from} a ${error.to}.` };
  }

  if (error instanceof KnowledgeCandidateNotFoundError) {
    return { code: "NOT_FOUND", message: "No encontramos ese candidato de conocimiento." };
  }

  if (error instanceof InvalidCandidateStatusTransitionError) {
    return { code: "INVALID_TRANSITION", message: `Este candidato no puede pasar de ${error.from} a ${error.to} — ya fue revisado.` };
  }

  if (error instanceof OutcomeNotAllowedForDecisionStatusError || error instanceof MissingOutcomeAttributionError) {
    return { code: "INVALID_TRANSITION", message: error.message };
  }

  if (error instanceof CriticalInformationMissingError) {
    return {
      code: "MISSING_CRITICAL_INFORMATION",
      message: "Todavía no hay suficiente información para analizar esta conversación.",
    };
  }

  if (error instanceof ConversationAnalysisFailedError || error instanceof DecisionGenerationFailedError) {
    return isProviderUnavailableCause(error.cause)
      ? { code: "PROVIDER_UNAVAILABLE", message: "Kori no está disponible en este momento. Inténtalo nuevamente en unos minutos." }
      : { code: "ORCHESTRATION_FAILURE", message: "Kori no pudo terminar de analizar esta conversación. Inténtalo nuevamente en unos minutos." };
  }

  if (error instanceof OrchestrationTransactionError) {
    return { code: "ORCHESTRATION_FAILURE", message: "No se pudo completar esa acción. No se realizó ningún cambio — inténtalo de nuevo." };
  }

  // Kori NL query errors — never surface `.cause` (a sanitized Groq error
  // body or Zod issue list) or any other detail beyond these pre-crafted
  // messages; that's exactly the kind of provider/internal detail this
  // mapping function exists to keep off the client.
  if (error instanceof UnsupportedKoriQuestionError || error instanceof InvalidKoriQuerySpecError) {
    return { code: "UNSUPPORTED_QUESTION", message: "Kori todavía no puede responder ese tipo de consulta." };
  }

  if (error instanceof KoriProviderRateLimitedError) {
    return { code: "RATE_LIMITED", message: "Kori está temporalmente saturado. Inténtalo de nuevo en un momento." };
  }

  if (error instanceof KoriAIConfigurationError || error instanceof KoriNaturalLanguageParseError) {
    return { code: "PROVIDER_UNAVAILABLE", message: "Kori no está disponible en este momento. Inténtalo nuevamente en unos minutos." };
  }

  return { code: "INTERNAL_ERROR", message: "Ocurrió un error. Inténtalo nuevamente en unos minutos." };
}

/** Every application handler's outermost boundary — no exception ever escapes uncaught. */
export async function toApplicationResult<T>(run: () => Promise<T>): Promise<ApplicationResult<T>> {
  try {
    return ok(await run());
  } catch (error) {
    return { ok: false, error: toApplicationError(error) };
  }
}
