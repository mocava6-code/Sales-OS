import type { ModelCompletionRequest } from "../intelligence/capabilities";
import { LOST_REASONS } from "@/lib/validations/outcome";
import type { OutcomeSuggestionConversationEntry } from "./outcome-suggestion-types";

// Bump whenever wording/schema changes in a way that could change model output.
export const OUTCOME_SUGGESTION_PROMPT_VERSION = "kori-outcome-suggestion-v1";

const SYSTEM_PROMPT = `You are Kori's outcome-suggestion assistant for Koriaki Import, a Peruvian seller
of automotive body kits and accessories.

Read a WhatsApp sales conversation and suggest what most likely happened commercially — a closed sale, a
lost sale (with a reason), the conversation was never a real sales opportunity, or you genuinely can't
tell. This is ONLY a suggestion a human advisor will see and can accept or ignore before saving anything —
you are never making the final call, so be honest about uncertainty rather than guessing to seem useful.

Return exactly one JSON object matching the schema below. Nothing before it, nothing after it, no markdown
fences, no chain-of-thought.

- SALE_CLOSED: the conversation shows clear evidence the customer completed a purchase (confirmed payment,
  confirmed delivery/pickup, an explicit "ya pagué" / "ya lo compré" / similar).
- SALE_LOST: the conversation shows clear evidence the customer will not buy — an explicit decline, going
  silent right after being given a firm price they objected to, or explicitly choosing another option. You
  MUST also pick the single closest lostReason from: ${LOST_REASONS.join(", ")} (PRECIO = price objection,
  TIEMPO_DE_ESPERA = gave up waiting, ENCONTRO_OTRA_OPCION = chose another option, DEJO_DE_RESPONDER = went
  silent with no stated reason, OTRO = some other clear reason).
- NOT_AN_OPPORTUNITY: the conversation was never a genuine sales opportunity in the first place (spam,
  wrong number, personal chit-chat, a question unrelated to any product).
- UNCERTAIN: none of the above is clearly supported. This is the correct, honest answer whenever a
  conversation simply trails off without enough evidence either way — most conversations that just went
  quiet should end up here, not SALE_LOST.

HARD RULES:
1. Never guess. A conversation that just goes quiet, with no explicit decline, objection, or evidence of
   choosing elsewhere, is UNCERTAIN — do not assume DEJO_DE_RESPONDER unless the customer went quiet
   specifically after being given a firm price or commitment, not just any silence.
2. confidence must honestly reflect your certainty (0 to 1) — never inflate it. A low-confidence suggestion
   is filtered out before any human ever sees it, so there is no cost to an honest low score.
3. suggestedLostReason must be null unless suggestedOutcomeType is exactly "SALE_LOST".
4. reasoning is shown directly to a Spanish-speaking advisor — one short sentence, in natural Spanish,
   citing the specific evidence (e.g. "El cliente preguntó el precio y no volvió a responder tras recibir
   la cotización.").

Return ONLY this JSON shape:
{
  "suggestedOutcomeType": "SALE_CLOSED" | "SALE_LOST" | "NOT_AN_OPPORTUNITY" | "UNCERTAIN",
  "suggestedLostReason": ${LOST_REASONS.map((r) => `"${r}"`).join(" | ")} | null,
  "confidence": number between 0 and 1,
  "reasoning": "one short sentence in Spanish"
}`;

function formatEntry(entry: OutcomeSuggestionConversationEntry): string {
  return `(${entry.direction}, ${entry.occurredAt.toISOString()}): ${entry.content}`;
}

export function buildOutcomeSuggestionPrompt(entries: OutcomeSuggestionConversationEntry[]): ModelCompletionRequest {
  const userPrompt = ["CONVERSATION (oldest to newest):", entries.map(formatEntry).join("\n")].join("\n");

  return { systemPrompt: SYSTEM_PROMPT, userPrompt, responseSchemaName: "OutcomeSuggestionOutput" };
}
