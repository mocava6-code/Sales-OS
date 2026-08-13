// Shared, deterministic-only text cleanup for provider adapters that ask a
// model for JSON via prompt instructions rather than a provider-enforced
// schema (Anthropic and Groq both work this way today — see their own
// adapter files). Never "repairs" semantically invalid or truncated JSON:
// if no clean JSON span can be found, the text is returned as-is and the
// pipeline's own Zod validation (not this helper) is what correctly
// rejects it.

const CODE_FENCE = /```(?:json)?\s*([\s\S]*?)```/i;

export function extractJsonCandidate(rawText: string): string {
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
