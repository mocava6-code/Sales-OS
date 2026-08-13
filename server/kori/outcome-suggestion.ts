// Kori Sales Memory v1's Fase C — a best-effort suggestion for "Marcar
// resultado," never a decision. Mirrors classifyConversationAction's own
// philosophy (server/services/conversation-action-state-service.ts): ANY
// failure — no provider configured, rate limiting, malformed output, low
// confidence, or the model genuinely not having an opinion — resolves to no
// suggestion (null) rather than throwing. The manual four-button flow must
// work exactly the same whether or not this ever returns anything, and
// nothing is ever written to the database from this path — it only informs
// what a human sees before they tap a button themselves.

import type { AIProvider } from "../intelligence/ai-provider";
import { buildOutcomeSuggestionPrompt } from "./outcome-suggestion-prompt";
import { outcomeSuggestionOutputSchema } from "./outcome-suggestion-schema";
import type { OutcomeSuggestion, OutcomeSuggestionConversationEntry } from "./outcome-suggestion-types";

/** A suggestion this unconfident is worse than none — filtered out before a human ever sees it. */
const CONFIDENCE_THRESHOLD = 0.7;

export interface SuggestConversationOutcomeDependencies {
  aiProvider?: AIProvider;
}

export async function suggestConversationOutcome(
  entries: OutcomeSuggestionConversationEntry[],
  deps: SuggestConversationOutcomeDependencies,
): Promise<OutcomeSuggestion | null> {
  const capability = deps.aiProvider?.capabilities.conversationAnalysis;
  if (!capability || entries.length === 0) return null;

  try {
    const request = buildOutcomeSuggestionPrompt(entries);
    const response = await capability.complete(request);
    const parsedJson = JSON.parse(response.rawText);
    const parsed = outcomeSuggestionOutputSchema.safeParse(parsedJson);
    if (!parsed.success) return null;
    const output = parsed.data;

    if (output.suggestedOutcomeType === "UNCERTAIN") return null;
    if (output.confidence < CONFIDENCE_THRESHOLD) return null;
    if (output.suggestedOutcomeType === "SALE_LOST" && !output.suggestedLostReason) return null;

    return {
      suggestedOutcomeType: output.suggestedOutcomeType,
      suggestedLostReason: output.suggestedOutcomeType === "SALE_LOST" ? output.suggestedLostReason : null,
      reasoning: output.reasoning,
    };
  } catch {
    return null;
  }
}
