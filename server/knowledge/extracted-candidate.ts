import type { ExtractionEvidenceRefType, ExtractionSectionContext } from "./types";

export const CONFIDENCE_FLOOR = 0.5;

/**
 * The extraction pipeline's fully-validated output — grounded, category-checked,
 * above the confidence floor. Still nothing more than a proposal: nothing in
 * server/knowledge/extract.ts ever writes this to KnowledgeCandidate directly
 * (that's server/knowledge/reinforcement.ts's job, which also decides
 * NEW/REINFORCED/CONFLICT).
 */
export interface ExtractedKnowledgeCandidate {
  class: "FACTUAL" | "BEHAVIORAL";
  proposedCategory: string;
  subject: string;
  statement: string;
  confidence: number;
  evidenceText: string;
  evidenceRefType: ExtractionEvidenceRefType;
  evidenceRefId: string;
  /** Set only when the evidence came from a DOCUMENT input's section. */
  chunkContext?: ExtractionSectionContext;
}
