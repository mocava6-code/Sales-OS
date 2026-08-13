// Deterministic LOGISTICS (shipping) candidate rule — zero-cost mode
// (Sprint 8 review). Deliberately does NOT reuse
// server/intelligence/lead-commercial-state/extractors/location-extractor.ts:
// that extractor's gazetteer/preposition pattern is tuned to catch "where
// does THIS customer want delivery" — the opposite signal from what
// organizational knowledge needs. This rule only matches a small, narrow
// set of general-scope shipping/policy phrasings, never a specific
// destination address. Same authoritative-position gating as
// compatibility-rule.ts (BUSINESS-direction message, or a PRODUCT/SERVICE/
// FAQ/POLICY website section).

import { normalizeContent } from "@/server/intelligence/observation/detectors/keyword-detectors";
import type { ExtractedKnowledgeCandidate } from "../../extracted-candidate";
import type { ExtractionInput, ExtractionSectionContext } from "../../types";

const RULE_CONFIDENCE = 0.65;
const AUTHORITATIVE_SECTION_CONTEXTS = new Set<ExtractionSectionContext>(["PRODUCT", "SERVICE", "FAQ", "POLICY"]);

// Deliberately narrow — general nationwide/regional shipping-policy
// statements and named couriers only. A phrase like "envíanos a mi casa en
// Surco" (a customer's own address) matches none of these.
const GENERAL_SHIPPING_PATTERNS: RegExp[] = [
  /env[ií]os?\s+a\s+nivel\s+nacional/,
  /enviamos\s+a\s+nivel\s+nacional/,
  /env[ií]os?\s+a\s+(todo\s+el\s+per[uú]|provincia)/,
  /enviamos\s+a\s+(todo\s+el\s+per[uú]|provincia)/,
  /env[ií]o\s+gratis/,
  /delivery\s+gratis/,
  /\b(shalom|olva\s*courier|cruz\s+del\s+sur)\b/,
];

function matchesShipping(normalized: string): boolean {
  return GENERAL_SHIPPING_PATTERNS.some((pattern) => pattern.test(normalized));
}

function buildCandidate(
  text: string,
  evidenceRefType: ExtractedKnowledgeCandidate["evidenceRefType"],
  evidenceRefId: string,
  chunkContext?: ExtractionSectionContext,
): ExtractedKnowledgeCandidate | null {
  const normalized = normalizeContent(text);
  if (!matchesShipping(normalized)) return null;

  const statement = text.trim();
  return {
    class: "FACTUAL",
    proposedCategory: "LOGISTICS",
    subject: "Envíos",
    statement,
    confidence: RULE_CONFIDENCE,
    evidenceText: statement,
    evidenceRefType,
    evidenceRefId,
    chunkContext,
  };
}

export function extractShippingCandidates(input: ExtractionInput): ExtractedKnowledgeCandidate[] {
  if (input.kind === "CONVERSATION") {
    const candidates: ExtractedKnowledgeCandidate[] = [];
    for (const message of input.messages) {
      if (message.role !== "BUSINESS") continue;
      const candidate = buildCandidate(message.content, message.evidenceRefType, message.evidenceRefId);
      if (candidate) candidates.push(candidate);
    }
    return candidates;
  }

  const candidates: ExtractedKnowledgeCandidate[] = [];
  for (const section of input.document.sections) {
    if (!AUTHORITATIVE_SECTION_CONTEXTS.has(section.context)) continue;
    if (!section.reliable) continue; // Sprint 8 quality-fix review, item 1 — never a fact out of a fallback blob
    const candidate = buildCandidate(section.text, input.document.evidenceRefType, input.document.evidenceRefId, section.context);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}
