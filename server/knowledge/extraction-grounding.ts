// The hallucination gate for knowledge extraction — mirrors
// server/intelligence/grounding-validator.ts's philosophy exactly: every
// candidate's evidence is checked against real source text, not merely
// instructed in a prompt. Unlike the conversation-intelligence validator,
// a knowledge candidate that fails any check is dropped outright rather
// than demoted — a provisional candidate has no "partial credit" state to
// fall back to.

import { BEHAVIOR_CATEGORIES, FACTUAL_CATEGORIES, type KnowledgeExtractionProviderCandidate } from "./extraction-schema";
import { CONFIDENCE_FLOOR, type ExtractedKnowledgeCandidate } from "./extracted-candidate";
import type { ExtractionInput } from "./types";

export interface DroppedCandidate {
  evidenceRefIndex: number;
  subject: string;
  reason: string;
}

export interface GroundingResult {
  candidates: ExtractedKnowledgeCandidate[];
  dropped: DroppedCandidate[];
}

function resolveEvidenceUnit(
  input: ExtractionInput,
  evidenceRefIndex: number,
): { text: string; evidenceRefType: ExtractedKnowledgeCandidate["evidenceRefType"]; evidenceRefId: string; chunkContext?: ExtractedKnowledgeCandidate["chunkContext"] } | null {
  if (input.kind === "CONVERSATION") {
    const message = input.messages[evidenceRefIndex];
    if (!message) return null;
    return { text: message.content, evidenceRefType: message.evidenceRefType, evidenceRefId: message.evidenceRefId };
  }

  const section = input.document.sections[evidenceRefIndex];
  if (!section) return null;
  return {
    text: section.text,
    evidenceRefType: input.document.evidenceRefType,
    evidenceRefId: input.document.evidenceRefId,
    chunkContext: section.context,
  };
}

function isVerbatimSubstring(quote: string, sourceText: string): boolean {
  const normalizedQuote = quote.trim().toLowerCase();
  if (normalizedQuote.length === 0) return false;
  return sourceText.toLowerCase().includes(normalizedQuote);
}

export function validateAndResolveCandidates(
  rawCandidates: KnowledgeExtractionProviderCandidate[],
  input: ExtractionInput,
): GroundingResult {
  const candidates: ExtractedKnowledgeCandidate[] = [];
  const dropped: DroppedCandidate[] = [];

  for (const raw of rawCandidates) {
    const unit = resolveEvidenceUnit(input, raw.evidenceRefIndex);
    if (!unit) {
      dropped.push({ evidenceRefIndex: raw.evidenceRefIndex, subject: raw.subject, reason: "evidenceRefIndex out of range" });
      continue;
    }

    if (!isVerbatimSubstring(raw.evidenceQuote, unit.text)) {
      dropped.push({ evidenceRefIndex: raw.evidenceRefIndex, subject: raw.subject, reason: "evidenceQuote is not a verbatim substring of the cited source" });
      continue;
    }

    const allowedCategories = raw.class === "FACTUAL" ? FACTUAL_CATEGORIES : BEHAVIOR_CATEGORIES;
    if (!(allowedCategories as readonly string[]).includes(raw.proposedCategory)) {
      dropped.push({ evidenceRefIndex: raw.evidenceRefIndex, subject: raw.subject, reason: `proposedCategory "${raw.proposedCategory}" is not valid for class "${raw.class}"` });
      continue;
    }

    // Deterministic backstop for the prompt's website-specific rule (Sprint
    // 8 review, item 8/3) — a MARKETING/TESTIMONIAL section must never
    // produce a FACTUAL candidate, regardless of what the model returned.
    if (raw.class === "FACTUAL" && (unit.chunkContext === "MARKETING" || unit.chunkContext === "TESTIMONIAL")) {
      dropped.push({ evidenceRefIndex: raw.evidenceRefIndex, subject: raw.subject, reason: `FACTUAL candidate sourced from a ${unit.chunkContext} section — not authoritative` });
      continue;
    }

    if (raw.confidence < CONFIDENCE_FLOOR) {
      dropped.push({ evidenceRefIndex: raw.evidenceRefIndex, subject: raw.subject, reason: `confidence ${raw.confidence} below floor ${CONFIDENCE_FLOOR}` });
      continue;
    }

    candidates.push({
      class: raw.class,
      proposedCategory: raw.proposedCategory,
      subject: raw.subject,
      statement: raw.statement,
      confidence: raw.confidence,
      evidenceText: raw.evidenceQuote,
      evidenceRefType: unit.evidenceRefType,
      evidenceRefId: unit.evidenceRefId,
      chunkContext: unit.chunkContext,
    });
  }

  return { candidates, dropped };
}
