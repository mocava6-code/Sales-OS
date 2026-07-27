import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider } from "../ai-provider";
import type {
  ConversationAnalysisCapability,
  DecisionReasoningCapability,
  KnowledgeExtractionCapability,
  ModelCompletionRequest,
  ModelCompletionResponse,
} from "../capabilities";

// Anthropic-specific code lives ONLY in this file. No other module in
// server/intelligence imports "@anthropic-ai/sdk" or any Anthropic type —
// the injection seam below (`sendMessage`) means even this adapter's own
// tests never need to import or fake the SDK's response shape. This file
// only ever: communicates with the Anthropic API, serializes requests,
// deserializes responses, and exposes the capabilities it supports. It
// contains no business rules, no Koriaki-specific knowledge, no grounding,
// confidence, or validation logic — all of that lives in the engine.

const DEFAULT_MAX_TOKENS = 2048;
// Deterministic extraction/reasoning, not creative writing — no randomness needed.
const GENERATION_TEMPERATURE = 0;

type SendMessage = (args: { systemPrompt: string; userPrompt: string }) => Promise<string>;

export interface AnthropicAIProviderConfig {
  model: string;
  /** Required unless `sendMessage` is injected (e.g. in tests). Never hardcode this. */
  apiKey?: string;
  maxTokens?: number;
  /**
   * Injection seam: bypasses the real Anthropic SDK entirely and returns raw
   * model text directly. Tests use this so they never need an API key and
   * never need to know the Anthropic SDK's response shape.
   */
  sendMessage?: SendMessage;
}

export class AnthropicProviderError extends Error {}
export class AnthropicEmptyResponseError extends AnthropicProviderError {}

function createRealSendMessage(config: AnthropicAIProviderConfig): SendMessage {
  if (!config.apiKey) {
    throw new AnthropicProviderError(
      "AnthropicAIProviderConfig.apiKey is required when no sendMessage override is injected.",
    );
  }

  const client = new Anthropic({ apiKey: config.apiKey });
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;

  return async ({ systemPrompt, userPrompt }) => {
    const response = await client.messages.create({
      model: config.model,
      system: systemPrompt,
      max_tokens: maxTokens,
      temperature: GENERATION_TEMPERATURE,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    return textBlock && textBlock.type === "text" ? textBlock.text : "";
  };
}

const CODE_FENCE = /```(?:json)?\s*([\s\S]*?)```/i;

/**
 * Superficial, deterministic cleanup only — strips a markdown code fence or
 * takes the outermost {...} span when there's surrounding prose. Never
 * "repairs" semantically invalid or truncated JSON: if no clean JSON span
 * can be found, the text is returned as-is and the pipeline's own schema
 * validation (not this adapter) is what correctly rejects it.
 */
function extractJsonCandidate(rawText: string): string {
  const trimmed = rawText.trim();

  const fenced = CODE_FENCE.exec(trimmed);
  if (fenced) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

// ConversationAnalysisCapability, DecisionReasoningCapability, and
// KnowledgeExtractionCapability are all "raw prompt in, raw text out" today
// — one implementation backs all three named capability slots. If any of
// them ever needs different generation settings or error handling, this is
// the one place that would split.
function createCompletionCapability(
  sendMessage: SendMessage,
): ConversationAnalysisCapability & DecisionReasoningCapability & KnowledgeExtractionCapability {
  return {
    async complete(request: ModelCompletionRequest): Promise<ModelCompletionResponse> {
      let rawText: string;
      try {
        rawText = await sendMessage({ systemPrompt: request.systemPrompt, userPrompt: request.userPrompt });
      } catch (cause) {
        if (cause instanceof AnthropicProviderError) throw cause;
        throw new AnthropicProviderError(
          `Anthropic request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }

      if (!rawText || rawText.trim().length === 0) {
        throw new AnthropicEmptyResponseError("Anthropic returned an empty response.");
      }

      return { rawText: extractJsonCandidate(rawText) };
    },
  };
}

/**
 * Anthropic as one implementation of AIProvider. Implements
 * ConversationAnalysisCapability and DecisionReasoningCapability today —
 * adding vision/embedding/speech later means populating more entries in
 * `capabilities` here, not changing this function's callers.
 */
export function createAnthropicAIProvider(config: AnthropicAIProviderConfig): AIProvider {
  const sendMessage = config.sendMessage ?? createRealSendMessage(config);
  const completion = createCompletionCapability(sendMessage);

  return {
    name: "anthropic",
    modelName: config.model,
    capabilities: {
      conversationAnalysis: completion,
      decisionReasoning: completion,
      knowledgeExtraction: completion,
    },
  };
}
