// The knowledge-extraction pipeline: build prompt -> call the model -> parse
// -> Zod-validate -> ground -> return. Mirrors
// server/intelligence/pipeline.ts's runConversationIntelligencePipeline
// shape exactly (same five steps, same typed-error-per-failure-mode
// discipline) — this is the one place that calls the LLM for knowledge
// extraction; nothing downstream (reinforcement, persistence) ever does.
//
// Known v1 simplification: a conversation/document is sent to the model in
// one call with no windowing. Very long WhatsApp exports may exceed a
// single call's context — chunking is a deliberate follow-up, not built
// here, since Koriaki's pilot conversation and ~20-page site both fit
// comfortably within one call.

import type { AIProvider } from "@/server/intelligence/ai-provider";
import {
  KnowledgeCapabilityNotSupportedError,
  KnowledgeModelProviderError,
  KnowledgeProviderResultSchemaError,
  MalformedKnowledgeProviderOutputError,
} from "./errors";
import type { ExtractedKnowledgeCandidate } from "./extracted-candidate";
import { validateAndResolveCandidates, type DroppedCandidate } from "./extraction-grounding";
import { knowledgeExtractionProviderResultSchema } from "./extraction-schema";
import { buildKoriKnowledgeExtractionPrompt, KORI_KNOWLEDGE_EXTRACTION_PROMPT_VERSION } from "./prompts/kori-knowledge-extraction-prompt";
import type { ExtractionInput } from "./types";

export { KORI_KNOWLEDGE_EXTRACTION_PROMPT_VERSION };

export interface ExtractKnowledgeCandidatesResult {
  candidates: ExtractedKnowledgeCandidate[];
  dropped: DroppedCandidate[];
  extractorVersion: string;
}

export interface ExtractKnowledgeCandidatesDependencies {
  aiProvider: AIProvider;
}

export async function extractKnowledgeCandidates(
  input: ExtractionInput,
  dependencies: ExtractKnowledgeCandidatesDependencies,
): Promise<ExtractKnowledgeCandidatesResult> {
  const capability = dependencies.aiProvider.capabilities.knowledgeExtraction;
  if (!capability) {
    throw new KnowledgeCapabilityNotSupportedError(dependencies.aiProvider.name);
  }

  const request = buildKoriKnowledgeExtractionPrompt(input);

  let rawText: string;
  try {
    const response = await capability.complete(request);
    rawText = response.rawText;
  } catch (cause) {
    throw new KnowledgeModelProviderError(`AI provider "${dependencies.aiProvider.name}" failed to complete the request.`, cause);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new MalformedKnowledgeProviderOutputError(`AI provider "${dependencies.aiProvider.name}" returned output that is not valid JSON.`);
  }

  const providerParse = knowledgeExtractionProviderResultSchema.safeParse(parsedJson);
  if (!providerParse.success) {
    throw new KnowledgeProviderResultSchemaError(
      `AI provider "${dependencies.aiProvider.name}" returned output that does not match the expected schema.`,
      providerParse.error.issues,
    );
  }

  const { candidates, dropped } = validateAndResolveCandidates(providerParse.data.candidates, input);

  return { candidates, dropped, extractorVersion: KORI_KNOWLEDGE_EXTRACTION_PROMPT_VERSION };
}
