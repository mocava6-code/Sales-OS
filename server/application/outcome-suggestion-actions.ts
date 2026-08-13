// Kori Sales Memory v1's Fase C — the "Kori sugiere" hint handler. Same
// five-step pattern as outcome-actions.ts, except step 4 never throws: any
// AI failure or lack of opinion resolves to a successful `data: null`
// result, never an error — a suggestion is a nice-to-have overlay, not a
// capability the client needs to distinguish failure modes for.

import type { z } from "zod";
import { suggestConversationOutcomeSchema } from "@/lib/validations/outcome";
import { suggestConversationOutcome } from "@/server/kori/outcome-suggestion";
import type { OutcomeSuggestion } from "@/server/kori/outcome-suggestion-types";
import type { AIProvider } from "@/server/intelligence/ai-provider";
import { type AuthContextResolver, defaultAuthContextResolver, requireAuthenticatedUser } from "./auth";
import { loadAuthorizedConversation } from "./access-control";
import { InvalidInputError, type ApplicationResult, toApplicationResult } from "./errors";

/** Bounded to the same recent window as every other AI-facing conversation read (see response-action-service.ts's RECENT_ENTRIES_WINDOW). */
const RECENT_ENTRIES_WINDOW = 15;

export interface OutcomeSuggestionActionDependencies {
  resolver?: AuthContextResolver;
  aiProvider?: AIProvider;
}

function parseOrThrow<Schema extends z.ZodTypeAny>(schema: Schema, rawInput: unknown): z.infer<Schema> {
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    throw new InvalidInputError(parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}

export function suggestConversationOutcomeHandler(
  rawInput: unknown,
  dependencies: OutcomeSuggestionActionDependencies = {},
): Promise<ApplicationResult<OutcomeSuggestion | null>> {
  return toApplicationResult(async () => {
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    const input = parseOrThrow(suggestConversationOutcomeSchema, rawInput);

    const conversation = await loadAuthorizedConversation(user, input.conversationId);
    const entries = conversation.entries
      .slice(-RECENT_ENTRIES_WINDOW)
      .map((entry) => ({ direction: entry.direction, content: entry.content, occurredAt: entry.occurredAt }));

    return suggestConversationOutcome(entries, { aiProvider: dependencies.aiProvider });
  });
}
