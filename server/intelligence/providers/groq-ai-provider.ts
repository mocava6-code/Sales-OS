import type { AIProvider } from "../ai-provider";
import type { ConversationAnalysisCapability, DecisionReasoningCapability, KnowledgeExtractionCapability, ModelCompletionRequest, ModelCompletionResponse } from "../capabilities";
import type { GroqClient } from "../../kori/groq-client";
import { extractJsonCandidate } from "./json-extraction";

// Groq as an AIProvider — Phase 4 of the Semantic Response Intelligence
// production mission. Deliberately built as a thin adapter OVER
// server/kori/groq-client.ts's already-tested GroqClient (same HTTP
// mechanics, same KoriProviderRateLimitedError/KoriNaturalLanguageParseError
// handling Kori's NL parser already relies on in production) rather than a
// second, duplicate raw-fetch implementation — GroqClient itself stays
// AIProvider-agnostic per its own doc comment; this file is the one place
// that bridges it into the capability-based abstraction.
//
// Uses plain JSON-object mode (not Groq's strict json_schema mode) — same
// complexity level as the Anthropic adapter: ask for JSON via prompt
// instructions, strip code-fence/prose defensively, and let the caller's
// Zod validation (ai-classifier.ts's conversationActionClassificationOutputSchema)
// be the actual safety net. Strict schema mode is a possible future
// tightening, not required for this to be safe today.

export class GroqProviderError extends Error {}
export class GroqEmptyResponseError extends GroqProviderError {}

// ConversationAnalysisCapability, DecisionReasoningCapability, and
// KnowledgeExtractionCapability are all "raw prompt in, raw text out"
// today — one implementation backs all three named capability slots, same
// as the Anthropic adapter.
function createCompletionCapability(
  groqClient: GroqClient,
): ConversationAnalysisCapability & DecisionReasoningCapability & KnowledgeExtractionCapability {
  return {
    async complete(request: ModelCompletionRequest): Promise<ModelCompletionResponse> {
      let rawText: string;
      try {
        rawText = await groqClient.complete({ systemPrompt: request.systemPrompt, userPrompt: request.userPrompt });
      } catch (cause) {
        // GroqClient's own typed errors (KoriProviderRateLimitedError,
        // KoriNaturalLanguageParseError, ...) already carry a precise,
        // secret-free message — pass them through unwrapped so a caller
        // can still distinguish "rate limited" from "malformed response"
        // if it ever wants to; ai-classifier.ts itself just wraps whatever
        // it catches into ModelProviderError either way.
        throw cause;
      }

      if (!rawText || rawText.trim().length === 0) {
        throw new GroqEmptyResponseError("Groq returned an empty response.");
      }

      return { rawText: extractJsonCandidate(rawText) };
    },
  };
}

export interface GroqAIProviderConfig {
  groqClient: GroqClient;
}

/**
 * Groq as one implementation of AIProvider, backed by an already-constructed
 * GroqClient (see server/intelligence/provider-factory.ts for how
 * GROQ_API_KEY/AI_MODEL become one). Implements ConversationAnalysisCapability,
 * DecisionReasoningCapability, and KnowledgeExtractionCapability — same
 * capability surface as the Anthropic adapter.
 */
export function createGroqAIProvider(config: GroqAIProviderConfig): AIProvider {
  const completion = createCompletionCapability(config.groqClient);

  return {
    name: "groq",
    modelName: config.groqClient.model,
    capabilities: {
      conversationAnalysis: completion,
      decisionReasoning: completion,
      knowledgeExtraction: completion,
    },
  };
}
