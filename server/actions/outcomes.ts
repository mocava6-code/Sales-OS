"use server";

// Thin Next.js server action wrapper — see server/application/outcome-actions.ts
// for the real logic.

import { recordConversationOutcomeHandler } from "@/server/application/outcome-actions";

export async function recordConversationOutcomeAction(rawInput: unknown) {
  return recordConversationOutcomeHandler(rawInput);
}
