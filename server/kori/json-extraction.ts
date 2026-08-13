// Shared, deterministic cleanup for a raw Groq completion that's supposed
// to be JSON but may arrive wrapped in a code fence or surrounded by prose.
// Never repairs malformed JSON, only strips surrounding fence/prose — the
// same superficial extraction nl-query-parser.ts and the Anthropic
// adapter's own extractJsonCandidate both already rely on, factored out
// here so a second Groq-backed classifier (strategic-intent-classifier.ts)
// doesn't have to redefine it.

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
