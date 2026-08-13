// AI layer of Semantic Response Intelligence v0 — invoked ONLY when
// classify-conversation-action.ts's deterministic pass is inconclusive.
// Reuses the SAME AIProvider/conversationAnalysis capability slot the
// Conversation Intelligence Engine already uses (server/intelligence/
// ai-provider.ts) — structurally identical "raw prompt in, raw JSON text
// out" contract — rather than adding a new capability or a competing AI
// integration. Mirrors server/intelligence/decision/pipeline.ts's own
// shape: build prompt -> invoke -> parse -> Zod-validate -> ground ->
// return, throwing the same typed errors on genuine failure so the
// orchestrator (not this file) decides what "AI unavailable" ultimately
// resolves to.

import type { AIProvider } from "../ai-provider";
import { AICapabilityNotSupportedError, MalformedProviderOutputError, ModelProviderError, ProviderResultSchemaError } from "../errors";
import { normalizeContent } from "../observation/detectors/keyword-detectors";
import { buildResponseActionPrompt, RESPONSE_ACTION_PROMPT_VERSION } from "./prompt";
import { conversationActionClassificationOutputSchema } from "./schema";
import type { ActionClassificationResult, ConversationActionContext } from "./types";

// Defense in depth for the same principle deterministic-classifier.ts
// already enforces (an explicit decline must never be auto-resolved to
// "nothing to do") — confirmed necessary against a real Groq production
// call during Phase 5 evaluation: the model resolved "lo lamento pero no
// quiero" to NO_ACTION_REQUIRED at 0.9 confidence despite the prompt's own
// instructions. Prompt wording alone isn't a reliable enough guarantee for
// something this dangerous, so it's enforced here in code too, regardless
// of what the model returns or how confident it claims to be.
const DECLINE_KEYWORDS = ["no quiero", "no me interesa", "no lo necesito", "no la necesito", "ya no lo necesito", "ya no la necesito"] as const;

function lastInboundContent(context: ConversationActionContext): string | null {
  for (let i = context.recentEntries.length - 1; i >= 0; i--) {
    if (context.recentEntries[i].direction === "INBOUND") return context.recentEntries[i].content;
  }
  return null;
}

function isExplicitDecline(context: ConversationActionContext): boolean {
  const content = lastInboundContent(context);
  if (!content) return false;
  const normalized = normalizeContent(content);
  return DECLINE_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

/**
 * "Use conservative thresholds" — a result below this is never trusted as
 * one of the four actionable states, regardless of what the model
 * returned; classifyConversationActionWithAI coerces it to UNCERTAIN
 * itself so every caller gets the same safety guarantee, not just the ones
 * that remember to check.
 */
export const AI_CONFIDENCE_THRESHOLD = 0.65;

export const RESPONSE_ACTION_AI_ENGINE_VERSION = `ai.${RESPONSE_ACTION_PROMPT_VERSION}`;

export interface ClassifyWithAIDependencies {
  aiProvider: AIProvider;
}

/**
 * Throws (never silently returns a bad result) on: unsupported capability,
 * provider failure, unparseable output, or schema validation failure — the
 * orchestrator catches these and falls back to UNCERTAIN. What this
 * function DOES guarantee on a successful return: the result is grounded
 * (every cited entry id was actually shown to the model, and a non-
 * UNCERTAIN state always cites at least one) and confidence-gated (below
 * AI_CONFIDENCE_THRESHOLD is coerced to UNCERTAIN before it ever reaches
 * the caller).
 */
export async function classifyConversationActionWithAI(context: ConversationActionContext, deps: ClassifyWithAIDependencies): Promise<ActionClassificationResult> {
  const capability = deps.aiProvider.capabilities.conversationAnalysis;
  if (!capability) {
    throw new AICapabilityNotSupportedError(deps.aiProvider.name, "conversationAnalysis");
  }

  const request = buildResponseActionPrompt(context);

  let rawText: string;
  try {
    const response = await capability.complete(request);
    rawText = response.rawText;
  } catch (cause) {
    throw new ModelProviderError(`AI provider "${deps.aiProvider.name}" failed to complete the response-action classification request.`, cause);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new MalformedProviderOutputError(`AI provider "${deps.aiProvider.name}" returned response-action output that is not valid JSON.`);
  }

  const parseResult = conversationActionClassificationOutputSchema.safeParse(parsedJson);
  if (!parseResult.success) {
    throw new ProviderResultSchemaError(
      `AI provider "${deps.aiProvider.name}" returned response-action output that does not match the expected schema.`,
      parseResult.error.issues,
    );
  }
  const output = parseResult.data;

  const validEntryIds = new Set(context.recentEntries.map((e) => e.id));
  const allEvidenceGrounded = output.evidenceEntryIds.every((id) => validEntryIds.has(id));
  const hasRequiredEvidence = output.actionState === "UNCERTAIN" || output.evidenceEntryIds.length > 0;
  const isGrounded = allEvidenceGrounded && hasRequiredEvidence;

  if (!isGrounded) {
    return {
      actionState: "UNCERTAIN",
      reasonCode: "UNCERTAIN_CONTEXT",
      confidence: output.confidence,
      reasoning: `AI response was not adequately grounded (missing or invalid evidence entry ids) — treated as uncertain rather than trusted. Original reasoning: ${output.reasoning}`,
      evidenceEntryIds: output.evidenceEntryIds.filter((id) => validEntryIds.has(id)),
      recommendedAction: null,
      source: "AI",
    };
  }

  if (output.confidence < AI_CONFIDENCE_THRESHOLD) {
    return {
      actionState: "UNCERTAIN",
      reasonCode: "AMBIGUOUS_INTENT",
      confidence: output.confidence,
      reasoning: `AI confidence (${output.confidence}) is below the safety threshold (${AI_CONFIDENCE_THRESHOLD}) — treated as uncertain rather than trusted. Original assessment: ${output.reasoning}`,
      evidenceEntryIds: output.evidenceEntryIds,
      recommendedAction: null,
      source: "AI",
    };
  }

  if ((output.actionState === "NO_ACTION_REQUIRED" || output.actionState === "WAITING_ON_CUSTOMER") && isExplicitDecline(context)) {
    return {
      actionState: "UNCERTAIN",
      reasonCode: "UNCERTAIN_CONTEXT",
      confidence: output.confidence,
      reasoning: `Safety override: the customer's message contains an explicit decline, which must never resolve to ${output.actionState} — coerced to UNCERTAIN regardless of model confidence. Original AI assessment: ${output.reasoning}`,
      evidenceEntryIds: output.evidenceEntryIds,
      recommendedAction: null,
      source: "AI",
    };
  }

  return {
    actionState: output.actionState,
    reasonCode: output.reasonCode,
    confidence: output.confidence,
    reasoning: output.reasoning,
    evidenceEntryIds: output.evidenceEntryIds,
    recommendedAction: output.recommendedAction,
    source: "AI",
  };
}
