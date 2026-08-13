// Deterministic delivery-location extractor, two tiers in one pass:
// a gazetteer match (known Peru districts/cities — higher confidence,
// canonical casing) and a generic pattern fallback ("envíos a/en X" —
// lower confidence, whatever follows the preposition regardless of
// whether it's a recognized place). A real address-validation/geocoding
// tier is out of scope; this is "extract what was typed," not "verify it's
// a real address."

import { normalizeContent } from "../../observation/detectors/keyword-detectors";
import type { FieldCandidate, FieldExtractor, NormalizedMessageForExtraction } from "../types";

/** Canonical display casing per known place — keys pre-normalized (lowercase, no diacritics). */
export const KNOWN_PERU_LOCATIONS: Record<string, string> = {
  chaclacayo: "Chaclacayo",
  chosica: "Chosica",
  lima: "Lima",
  ate: "Ate",
  "la molina": "La Molina",
  surco: "Surco",
  miraflores: "Miraflores",
  callao: "Callao",
};

const DELIVERY_PREPOSITION_PATTERN = /\b(?:env[ií]os?|entregas?|delivery|reparto)\s+(?:a|en|hacia|para)\s+([a-z][a-z\s]{1,30}?)(?=[?.,!]|\s+(?:para|de|el|la|los|las)\b|$)/;

const GAZETTEER_CONFIDENCE = 0.85;
const PATTERN_FALLBACK_CONFIDENCE = 0.5;
const LOCATION_EXTRACTOR_VERSION = "1.0.0";

function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .map((word) => (word.length === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}

function toCandidate(
  value: string,
  confidence: number,
  message: NormalizedMessageForExtraction,
  reasoning: string,
): FieldCandidate<string> {
  return {
    value,
    confidence,
    conversationId: message.conversationId,
    occurredAt: message.occurredAt,
    evidence: [{ sourceType: "conversation_message", sourceId: message.id, excerpt: message.content }],
    reasoning,
  };
}

export const deliveryLocationExtractor: FieldExtractor<string> = {
  id: "deterministic.delivery_location",
  version: LOCATION_EXTRACTOR_VERSION,
  extract(messages: NormalizedMessageForExtraction[]): FieldCandidate<string>[] {
    const candidates: FieldCandidate<string>[] = [];

    for (const message of messages) {
      const normalized = normalizeContent(message.content);

      // Gazetteer tier first — a known place name anywhere in the message.
      const gazetteerMatch = Object.entries(KNOWN_PERU_LOCATIONS).find(([key]) => normalized.includes(key));
      if (gazetteerMatch) {
        candidates.push(
          toCandidate(gazetteerMatch[1], GAZETTEER_CONFIDENCE, message, "Coincide con un distrito/ciudad conocido del Perú."),
        );
        continue; // gazetteer hit is strictly better than the generic pattern for the same message — don't double-candidate it
      }

      // Pattern fallback — whatever follows a delivery-related preposition, regardless of whether it's a recognized place.
      const patternMatch = DELIVERY_PREPOSITION_PATTERN.exec(normalized);
      if (patternMatch) {
        const raw = patternMatch[1].trim();
        if (raw.length > 0) {
          candidates.push(
            toCandidate(titleCase(raw), PATTERN_FALLBACK_CONFIDENCE, message, "Coincide con una frase genérica de 'envío a X' — X no es un lugar reconocido."),
          );
        }
      }
    }

    return candidates;
  },
};
