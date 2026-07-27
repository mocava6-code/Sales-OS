// Typed extraction-pipeline errors — same discipline as
// server/intelligence/errors.ts: every fatal failure is one of these, never
// a bare Error. Recoverable per-candidate problems (bad evidence, an
// out-of-vocabulary category) are never represented here — they just mean
// that candidate is silently dropped from the result, not that the whole
// extraction run fails.

export abstract class KnowledgeExtractionError extends Error {
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class KnowledgeCapabilityNotSupportedError extends KnowledgeExtractionError {
  readonly code = "KNOWLEDGE_CAPABILITY_NOT_SUPPORTED";

  constructor(providerName: string) {
    super(`AI provider "${providerName}" does not support the "knowledgeExtraction" capability.`);
  }
}

export class KnowledgeModelProviderError extends KnowledgeExtractionError {
  readonly code = "KNOWLEDGE_MODEL_PROVIDER_ERROR";

  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

export class MalformedKnowledgeProviderOutputError extends KnowledgeExtractionError {
  readonly code = "MALFORMED_KNOWLEDGE_PROVIDER_OUTPUT";

  constructor(message: string) {
    super(message);
  }
}

export class KnowledgeProviderResultSchemaError extends KnowledgeExtractionError {
  readonly code = "KNOWLEDGE_PROVIDER_RESULT_SCHEMA_ERROR";

  constructor(
    message: string,
    public readonly issues: unknown,
  ) {
    super(message);
  }
}

export class KnowledgeCandidateNotFoundError extends KnowledgeExtractionError {
  readonly code = "KNOWLEDGE_CANDIDATE_NOT_FOUND";

  constructor(public readonly candidateId: string) {
    super(`No KnowledgeCandidate found with id "${candidateId}".`);
  }
}

export class InvalidCandidateStatusTransitionError extends KnowledgeExtractionError {
  readonly code = "INVALID_CANDIDATE_STATUS_TRANSITION";

  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Cannot transition a knowledge candidate from "${from}" to "${to}" — it is already terminal.`);
  }
}
