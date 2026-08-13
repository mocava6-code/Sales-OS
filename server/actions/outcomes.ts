"use server";

// Thin Next.js server action wrappers — see server/application/outcome-actions.ts
// and server/application/outcome-suggestion-actions.ts for the real logic.

import { recordConversationOutcomeHandler } from "@/server/application/outcome-actions";
import { suggestConversationOutcomeHandler } from "@/server/application/outcome-suggestion-actions";
import { tryGetAIProvider } from "@/server/application/composition-root";

export async function recordConversationOutcomeAction(rawInput: unknown) {
  return recordConversationOutcomeHandler(rawInput);
}

export async function suggestConversationOutcomeAction(rawInput: unknown) {
  return suggestConversationOutcomeHandler(rawInput, { aiProvider: tryGetAIProvider() });
}
