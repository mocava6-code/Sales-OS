// Decides NOT_NEEDED vs. PENDING — computed independently from whether any
// rule in ./rules produced a candidate (Sprint 8 review, point 2: an item
// can have deterministic candidates AND still need semantic analysis, since
// the narrow rules only catch two specific patterns). Deliberately biased
// toward PENDING: a false PENDING costs nothing but an eventual optional
// LLM check; a false NOT_NEEDED silently loses information forever. Never
// used as a generic default for "haven't processed this yet" — that's what
// NOT_EVALUATED (the Prisma column default) is for; this function only ever
// returns one of the two post-evaluation outcomes.

import {
  DISCOUNT_KEYWORDS,
  INSTALLATION_KEYWORDS,
  normalizeContent,
  PHOTO_KEYWORDS,
  PRICE_KEYWORDS,
} from "@/server/intelligence/observation/detectors/keyword-detectors";
import type { ExtractionInput, ExtractionSectionContext } from "../types";

export type SemanticAnalysisAssessment = "NOT_NEEDED" | "PENDING";

const MIN_SUBSTANTIVE_MESSAGE_LENGTH = 12;
const MIN_SUBSTANTIVE_SECTION_LENGTH = 20;
const AUTHORITATIVE_SECTION_CONTEXTS = new Set<ExtractionSectionContext>(["PRODUCT", "SERVICE", "FAQ", "POLICY"]);

// Greetings/acknowledgments/closings — content with genuinely nothing to
// analyze. Deliberately small and exact-match (anchored), not a substring
// list, so it never accidentally swallows a substantive message that merely
// starts with "ok" or "gracias" as part of a longer sentence.
const TRIVIAL_MESSAGE_PATTERNS: RegExp[] = [
  /^(hola|holi|buenas|buenos dias|buenas tardes|buenas noches|hey|hi|hello)[.! ]*$/,
  /^(gracias|muchas gracias|mil gracias|thank you|thanks)[.! ]*$/,
  /^(ok|okay|okey|listo|perfecto|de acuerdo|vale|dale)[.! ]*$/,
  /^(si|sí|no)[.! ]*$/,
  /^(chau|adios|adi[oó]s|hasta luego|nos vemos|bye)[.! ]*$/,
];

// Topics no deterministic rule in ./rules attempts to extract a value for
// (pricing especially — see the design report's explicit deferral) —
// any hit here means an LLM pass could plausibly find something real.
const UNHANDLED_TOPIC_KEYWORD_LISTS: readonly (readonly string[])[] = [
  PRICE_KEYWORDS,
  DISCOUNT_KEYWORDS,
  INSTALLATION_KEYWORDS,
  PHOTO_KEYWORDS,
];

function isTrivialMessage(content: string): boolean {
  const normalized = normalizeContent(content).trim();
  if (normalized.length < MIN_SUBSTANTIVE_MESSAGE_LENGTH) return true;
  return TRIVIAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasUnhandledTopicSignal(normalized: string): boolean {
  return UNHANDLED_TOPIC_KEYWORD_LISTS.some((keywords) => keywords.some((keyword) => normalized.includes(keyword)));
}

export function assessSemanticAnalysisNeed(input: ExtractionInput): SemanticAnalysisAssessment {
  if (input.kind === "CONVERSATION") {
    const needsAnalysis = input.messages.some((message) => {
      const normalized = normalizeContent(message.content);
      if (hasUnhandledTopicSignal(normalized)) return true;
      return !isTrivialMessage(message.content);
    });
    return needsAnalysis ? "PENDING" : "NOT_NEEDED";
  }

  const needsAnalysis = input.document.sections.some(
    (section) => AUTHORITATIVE_SECTION_CONTEXTS.has(section.context) && section.text.trim().length > MIN_SUBSTANTIVE_SECTION_LENGTH,
  );
  return needsAnalysis ? "PENDING" : "NOT_NEEDED";
}
