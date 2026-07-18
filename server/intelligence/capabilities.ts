// AI capability contracts. Providers are organized around what they can DO,
// not around any single vendor's method names — this is what keeps a
// provider's surface small (only the capabilities it actually supports)
// instead of one large interface full of methods most vendors don't have.

export interface ModelCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  /** Name of the expected output shape, for provider-side logging/debugging only. */
  responseSchemaName: string;
}

export interface ModelCompletionResponse {
  /** Raw model output text. The caller parses and Zod-validates it — the provider never does. */
  rawText: string;
}

/**
 * Used by the Conversation Intelligence Engine's pipeline to turn a
 * conversation + context into raw structured text for schema validation.
 */
export interface ConversationAnalysisCapability {
  complete(request: ModelCompletionRequest): Promise<ModelCompletionResponse>;
}

/**
 * Used by the Decision Engine (server/intelligence/decision) to propose
 * structured commercial decisions from a KoriDecisionContext. Structurally
 * identical to ConversationAnalysisCapability today (both are "raw prompt
 * in, raw text out") but kept as its own named capability slot — a provider
 * may support one without the other, and the two may diverge later (e.g.
 * different generation settings) without affecting callers of either.
 */
export interface DecisionReasoningCapability {
  complete(request: ModelCompletionRequest): Promise<ModelCompletionResponse>;
}

// --- Architectural placeholders -------------------------------------------
//
// Intentionally empty. A real method signature here would be a guess until
// an actual use case and a provider that implements it exist — that's
// exactly the kind of unimplemented, speculative surface this refactor is
// meant to avoid. When one of these becomes real, it gains real members;
// nothing upstream (AIProvider, the router, the registry) needs to change
// shape when that happens.

/** Placeholder for future draft/response generation (e.g. drafting outbound messages). */
export type DraftGenerationCapability = Record<string, never>;

/** Placeholder for future image understanding (e.g. reading a photo of a vehicle or part). */
export type VisionCapability = Record<string, never>;

/** Placeholder for future embeddings (e.g. semantic search over the knowledge base). */
export type EmbeddingCapability = Record<string, never>;

/** Placeholder for future speech-to-text / text-to-speech. */
export type SpeechCapability = Record<string, never>;
