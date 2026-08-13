// Deterministic COMPATIBILITY candidate rule — zero-cost mode (Sprint 8
// review). Reuses the existing vehicle/product vocabulary and keyword lists
// (imported, not duplicated) but does NOT reuse the extractors themselves:
// freetext-product-extractor.ts and the compatibility keyword detector are
// both lead-fact tools (they answer "what does this customer want"), and
// naively promoting their output would leak customer-specific facts into
// organizational knowledge. This rule only fires on a general statement in
// an authoritative position — a BUSINESS-direction WhatsApp message, or a
// PRODUCT/SERVICE/FAQ/POLICY website section (never MARKETING/TESTIMONIAL,
// reusing the classification already built in server/knowledge/website/page-extraction.ts)
// — AND only ever on a `reliable` section (Sprint 8 quality-fix review, item
// 1): a section that only exists as an unstructured, size-bounded fallback
// chunk is never treated as a safely groundable single fact, no matter what
// it matches.

import { KNOWN_PRODUCT_LINES, KNOWN_VEHICLE_MODELS } from "@/server/intelligence/lead-commercial-state/extractors/freetext-product-extractor";
import { COMPATIBILITY_KEYWORDS, normalizeContent } from "@/server/intelligence/observation/detectors/keyword-detectors";
import type { ExtractedKnowledgeCandidate } from "../../extracted-candidate";
import type { ExtractionInput, ExtractionSectionContext } from "../../types";

const RULE_CONFIDENCE = 0.65;
const AUTHORITATIVE_SECTION_CONTEXTS = new Set<ExtractionSectionContext>(["PRODUCT", "SERVICE", "FAQ", "POLICY"]);

function tokenize(text: string): Set<string> {
  return new Set(normalizeContent(text).split(/[^a-z0-9]+/).filter(Boolean));
}

function matchesAny(normalized: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => normalized.includes(keyword));
}

/**
 * A brand/model mention plus a compatibility keyword is not itself a fact —
 * "¿Buscas piezas para tu Toyota o Ford?" mentions two brands and nothing
 * else, "¿Cómo funciona?" only reads as compatibility-adjacent because a
 * neighboring sentence in the same block happens to say "compatibilidad"
 * (Sprint 8 quality-fix review, item 3). Requires at least one sentence that
 * both contains a compatibility keyword AND is not itself phrased as a
 * question — a generalizable structural check (interrogative-sentence
 * detection), not a match against specific wording.
 */
function hasAffirmativeCompatibilityStatement(text: string): boolean {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  return sentences.some((sentence) => {
    const trimmed = sentence.trim();
    if (trimmed.length === 0) return false;
    if (trimmed.startsWith("¿") || trimmed.endsWith("?")) return false;
    return matchesAny(normalizeContent(trimmed), COMPATIBILITY_KEYWORDS);
  });
}

function findDictionaryMatch(tokens: Set<string>, dictionary: Record<string, string>): string | null {
  for (const [key, canonical] of Object.entries(dictionary)) {
    const keyTokens = key.split(" ");
    if (keyTokens.every((t) => tokens.has(t))) return canonical;
  }
  return null;
}

/** Falls back to the small static dictionary only when no structural subject is available — the WhatsApp path (no cards/headings) always lands here. */
function deriveDictionarySubject(text: string): string | null {
  const tokens = tokenize(text);
  const vehicle = findDictionaryMatch(tokens, KNOWN_VEHICLE_MODELS);
  if (!vehicle) return null;
  const productLine = findDictionaryMatch(tokens, KNOWN_PRODUCT_LINES);
  return [vehicle, productLine].filter(Boolean).join(" ");
}

function buildCandidate(
  text: string,
  evidenceRefType: ExtractedKnowledgeCandidate["evidenceRefType"],
  evidenceRefId: string,
  chunkContext: ExtractionSectionContext | undefined,
  structuralSubject: string | null,
): ExtractedKnowledgeCandidate | null {
  if (!hasAffirmativeCompatibilityStatement(text)) return null;

  // Prefer an explicit structural subject (a product card's own title, a
  // page's nearest heading, or its page title) over reconstructing one from
  // the small static vehicle dictionary — Sprint 8 quality-fix review, item
  // 2. The dictionary is the fallback, not the primary source, for website
  // content; it never had a "Ranger"/"F-150"/"Prado" entry, so real catalog
  // pages about those vehicles were previously silently skipped.
  const subject = structuralSubject ?? deriveDictionarySubject(text);
  if (!subject) return null; // a compatibility phrase with no identifiable subject isn't safe to promote — leave it for semantic analysis

  const statement = text.trim();

  return {
    class: "FACTUAL",
    proposedCategory: "COMPATIBILITY",
    subject,
    statement,
    confidence: RULE_CONFIDENCE,
    evidenceText: statement,
    evidenceRefType,
    evidenceRefId,
    chunkContext,
  };
}

export function extractCompatibilityCandidates(input: ExtractionInput): ExtractedKnowledgeCandidate[] {
  if (input.kind === "CONVERSATION") {
    const candidates: ExtractedKnowledgeCandidate[] = [];
    for (const message of input.messages) {
      if (message.role !== "BUSINESS") continue; // never promote a customer's own words as organizational fact
      const candidate = buildCandidate(message.content, message.evidenceRefType, message.evidenceRefId, undefined, null);
      if (candidate) candidates.push(candidate);
    }
    return candidates;
  }

  const candidates: ExtractedKnowledgeCandidate[] = [];
  for (const section of input.document.sections) {
    if (!AUTHORITATIVE_SECTION_CONTEXTS.has(section.context)) continue;
    if (!section.reliable) continue; // Sprint 8 quality-fix review, item 1 — never a fact out of a fallback blob
    const structuralSubject = section.subjectHint ?? input.document.title ?? null;
    const candidate = buildCandidate(section.text, input.document.evidenceRefType, input.document.evidenceRefId, section.context, structuralSubject);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}
