// The zero-cost extraction pass (Sprint 8 review) — runs unconditionally,
// with or without an AI provider configured. Mirrors server/knowledge/extract.ts's
// shape (same ExtractionInput in, ExtractedKnowledgeCandidate[] out) so
// callers (sync-service.ts, knowledge-actions.ts) can treat deterministic
// and LLM extraction as two independent, composable passes over the same
// input rather than a fallback chain.

import type { ExtractedKnowledgeCandidate } from "../extracted-candidate";
import type { ExtractionInput } from "../types";
import { extractCompatibilityCandidates } from "./rules/compatibility-rule";
import { extractShippingCandidates } from "./rules/shipping-rule";
import { assessSemanticAnalysisNeed, type SemanticAnalysisAssessment } from "./semantic-need";

// Bumped whenever a rule's matching logic changes — persisted on every
// deterministic KnowledgeCandidate's extractorVersion, same convention as
// the LLM pipeline's KORI_KNOWLEDGE_EXTRACTION_PROMPT_VERSION.
export const DETERMINISTIC_EXTRACTOR_NAME = "deterministic";
export const DETERMINISTIC_EXTRACTOR_VERSION = "deterministic-knowledge-extract-v1";

export interface DeterministicExtractionResult {
  candidates: ExtractedKnowledgeCandidate[];
  /** Independent of `candidates` — see semantic-need.ts's header comment. */
  semanticAnalysisStatus: SemanticAnalysisAssessment;
}

export function extractDeterministicCandidates(input: ExtractionInput): DeterministicExtractionResult {
  const candidates: ExtractedKnowledgeCandidate[] = [...extractCompatibilityCandidates(input), ...extractShippingCandidates(input)];
  const semanticAnalysisStatus = assessSemanticAnalysisNeed(input);

  return { candidates, semanticAnalysisStatus };
}
