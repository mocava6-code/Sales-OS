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
