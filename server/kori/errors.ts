// Kori Natural Language Analytics v0 — deterministic query layer errors.
// Same convention as server/whatsapp/errors.ts / server/knowledge/errors.ts:
// an abstract base with a `.code`, instanceof-checkable, name = new.target.name.

export abstract class KoriQueryError extends Error {
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A KoriQuerySpec failed schema or cross-field validation — never reached the executor. */
export class InvalidKoriQuerySpecError extends KoriQueryError {
  readonly code = "INVALID_KORI_QUERY_SPEC";

  constructor(
    message: string,
    public readonly issues?: unknown,
  ) {
    super(message);
  }
}

// --- Kori Natural Language Parsing v0 -----------------------------------

/**
 * GROQ_API_KEY / KORI_GROQ_MODEL missing or otherwise misconfigured. Thrown
 * before any request to Groq is attempted — never a response-shape problem.
 */
export class KoriAIConfigurationError extends KoriQueryError {
  readonly code = "KORI_AI_CONFIGURATION_ERROR";

  constructor(message: string) {
    super(message);
  }
}

/**
 * The question could not be turned into KoriQuerySpec-compatible JSON at
 * all: empty/too-long input, a Groq request failure, or a response that
 * isn't even parseable JSON. Distinct from UnsupportedKoriQuestionError,
 * which means Groq *did* respond with valid JSON that just isn't a
 * supported query. Message text is a static, log/UI-safe description —
 * never the raw question or raw model output; those go in `cause` only.
 */
export class KoriNaturalLanguageParseError extends KoriQueryError {
  readonly code = "KORI_NATURAL_LANGUAGE_PARSE_ERROR";

  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

/**
 * Groq returned syntactically valid JSON, but it doesn't represent a
 * supported Kori query — either it explicitly signaled "unsupported" or its
 * JSON failed KoriQuerySpec validation. This is the expected outcome for
 * out-of-scope and adversarial questions (SQL requests, prompt injection,
 * requests for another business's data, write/delete requests, etc.) — it
 * is not itself evidence of an attack, just "no valid query for this."
 */
export class UnsupportedKoriQuestionError extends KoriQueryError {
  readonly code = "UNSUPPORTED_KORI_QUESTION";

  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}
