import type { AIProvider } from "./ai-provider";
import { createChannelAdapterRegistry } from "./channel-adapters/registry";
import type { ChannelAdapter } from "./channel-adapter";
import { computeOverallConfidence } from "./confidence";
import {
  AICapabilityNotSupportedError,
  ChannelAdapterNotFoundError,
  EngineInternalError,
  MalformedProviderOutputError,
  ModelProviderError,
  ProviderResultSchemaError,
} from "./errors";
import { validateGrounding, type GroundingContext } from "./grounding-validator";
import type { KnowledgeSnippet, KnowledgeSource } from "./knowledge-source";
import { buildKoriConversationAnalysisPrompt, KORI_CONVERSATION_ANALYSIS_PROMPT_VERSION } from "./prompts/kori-conversation-analysis-prompt";
import { conversationIntelligenceResultSchema, providerResultSchema } from "./schema";
import type { ConversationIntelligenceInput, ConversationIntelligenceResult, NormalizedMessage } from "./types";

export const ENGINE_SCHEMA_VERSION = 1;

export interface PipelineDependencies {
  aiProvider: AIProvider;
  /** Additional/override adapters beyond the built-in registry (see channel-adapters/registry.ts). */
  channelAdapters?: ChannelAdapter[];
  /** Optional — the pipeline works with none configured; no retrieval logic is implemented in this phase. */
  knowledgeSource?: KnowledgeSource;
}

/**
 * Runs steps 2-10 of the Conversation Intelligence pipeline against an
 * already-validated input (step 1 lives in analyze-conversation.ts).
 * Never throws anything but the typed errors in ./errors.
 */
export async function runConversationIntelligencePipeline(
  input: ConversationIntelligenceInput,
  dependencies: PipelineDependencies,
): Promise<ConversationIntelligenceResult> {
  // 2. Channel normalization
  const messages = resolveMessages(input, dependencies);

  // 3. Context preparation (optional — no retrieval logic implemented, just wiring)
  const knowledgeSnippets: KnowledgeSnippet[] = dependencies.knowledgeSource
    ? await dependencies.knowledgeSource.search(buildKnowledgeQuery(messages), input.tenantId)
    : [];

  // 4. AIProvider invocation (via its conversationAnalysis capability)
  const conversationAnalysis = dependencies.aiProvider.capabilities.conversationAnalysis;
  if (!conversationAnalysis) {
    throw new AICapabilityNotSupportedError(dependencies.aiProvider.name, "conversationAnalysis");
  }

  const request = buildKoriConversationAnalysisPrompt(input.channel, messages, knowledgeSnippets);
  let rawText: string;
  try {
    const response = await conversationAnalysis.complete(request);
    rawText = response.rawText;
  } catch (cause) {
    throw new ModelProviderError(`AI provider "${dependencies.aiProvider.name}" failed to complete the request.`, cause);
  }

  // 5. Raw provider output validation
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new MalformedProviderOutputError(
      `AI provider "${dependencies.aiProvider.name}" returned output that is not valid JSON.`,
    );
  }

  // 6. ConversationIntelligenceResult schema parsing (provider shape, minus metadata)
  const providerParse = providerResultSchema.safeParse(parsedJson);
  if (!providerParse.success) {
    throw new ProviderResultSchemaError(
      `AI provider "${dependencies.aiProvider.name}" returned output that does not match the expected schema.`,
      providerParse.error.issues,
    );
  }
  const providerResult = providerParse.data;

  // 7. Grounding validation
  const groundingContext: GroundingContext = { messages, knowledgeSnippets };
  const grounded = validateGrounding(providerResult, groundingContext);

  // 8 & 9. Confidence processing + warning aggregation.
  // providerResult.overallConfidence is intentionally never read below.
  const warnings = [...(providerResult.warnings ?? []), ...grounded.warnings];
  const overallConfidence = computeOverallConfidence(grounded.facts, grounded.inferences, warnings);

  // 10. Final normalized result
  const finalResult: ConversationIntelligenceResult = {
    metadata: {
      engineSchemaVersion: ENGINE_SCHEMA_VERSION,
      promptVersion: KORI_CONVERSATION_ANALYSIS_PROMPT_VERSION,
      modelProvider: dependencies.aiProvider.name,
      modelName: dependencies.aiProvider.modelName,
      analyzedAt: new Date(),
    },
    customerIdentification: grounded.customerIdentification,
    facts: grounded.facts,
    inferences: grounded.inferences,
    objections: grounded.objections,
    missingInformation: grounded.missingInformation,
    warnings,
    draftResponse: grounded.draftResponse,
    overallConfidence,
  };

  const finalCheck = conversationIntelligenceResultSchema.safeParse(finalResult);
  if (!finalCheck.success) {
    throw new EngineInternalError(
      "The assembled result did not conform to ConversationIntelligenceResultSchema.",
      finalCheck.error.issues,
    );
  }

  return finalCheck.data;
}

function resolveMessages(input: ConversationIntelligenceInput, dependencies: PipelineDependencies): NormalizedMessage[] {
  if (input.messages) {
    return input.messages;
  }

  const registry = createChannelAdapterRegistry(dependencies.channelAdapters);
  const adapter = registry.get(input.channel);
  if (!adapter) {
    throw new ChannelAdapterNotFoundError(input.channel);
  }
  return adapter.normalize(input.rawText ?? "");
}

function buildKnowledgeQuery(messages: NormalizedMessage[]): string {
  return messages.map((message) => message.content).join(" ");
}
