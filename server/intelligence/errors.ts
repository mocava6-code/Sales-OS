// Typed engine errors. Every fatal failure in the pipeline is thrown as one
// of these (never a bare Error, never an untyped object) — callers can
// `instanceof` or switch on `.code` to react appropriately. Recoverable
// problems (bad evidence, partial grounding) are never represented here —
// they become warnings on the result instead (see grounding-validator.ts).

export abstract class ConversationIntelligenceError extends Error {
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InputValidationError extends ConversationIntelligenceError {
  readonly code = "INPUT_VALIDATION_ERROR";

  constructor(
    message: string,
    public readonly issues: unknown,
  ) {
    super(message);
  }
}

export class ChannelAdapterNotFoundError extends ConversationIntelligenceError {
  readonly code = "CHANNEL_ADAPTER_NOT_FOUND";

  constructor(channel: string) {
    super(`No channel adapter registered for channel "${channel}".`);
  }
}

export class AICapabilityNotSupportedError extends ConversationIntelligenceError {
  readonly code = "AI_CAPABILITY_NOT_SUPPORTED";

  constructor(providerName: string, capability: string) {
    super(`AI provider "${providerName}" does not support the "${capability}" capability.`);
  }
}

export class ModelProviderError extends ConversationIntelligenceError {
  readonly code = "MODEL_PROVIDER_ERROR";

  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

export class MalformedProviderOutputError extends ConversationIntelligenceError {
  readonly code = "MALFORMED_PROVIDER_OUTPUT";

  constructor(message: string) {
    super(message);
  }
}

export class ProviderResultSchemaError extends ConversationIntelligenceError {
  readonly code = "PROVIDER_RESULT_SCHEMA_ERROR";

  constructor(
    message: string,
    public readonly issues: unknown,
  ) {
    super(message);
  }
}

export class EngineInternalError extends ConversationIntelligenceError {
  readonly code = "ENGINE_INTERNAL_ERROR";

  constructor(
    message: string,
    public readonly issues?: unknown,
  ) {
    super(message);
  }
}
