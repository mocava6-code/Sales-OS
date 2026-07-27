// The deterministic status derivation function — the ONLY thing that ever
// sets KnowledgeCandidate.status. Never written by the LLM directly (Sprint
// 8 review, item 5): the relationship classifier only ever produces a
// RelationshipClassification value; this pure function turns a set of those
// into a status.

export type PipelineCandidateStatus = "NEW" | "REINFORCED" | "CONFLICT";
export type RelationshipClassificationValue = "EQUIVALENT" | "CONTRADICTORY" | "RELATED" | "UNRELATED";

/**
 * CONFLICT is sticky (Sprint 8 review, state-machine clarification): once a
 * candidate is CONFLICT, no combination of new classifications — including a
 * fresh EQUIVALENT occurrence — moves it back to REINFORCED. Only an
 * explicit OWNER action (server/knowledge/promotion.ts, not this function)
 * ever moves a candidate out of CONFLICT. Equivalent occurrences still get
 * their evidence appended and occurrenceCount incremented by the caller —
 * this function only ever computes `status`, nothing else.
 */
export function deriveCandidateStatus(
  currentStatus: PipelineCandidateStatus,
  newClassifications: RelationshipClassificationValue[],
): PipelineCandidateStatus {
  if (currentStatus === "CONFLICT") return "CONFLICT";
  if (newClassifications.includes("CONTRADICTORY")) return "CONFLICT";
  if (currentStatus === "REINFORCED" || newClassifications.includes("EQUIVALENT")) return "REINFORCED";
  return "NEW";
}
