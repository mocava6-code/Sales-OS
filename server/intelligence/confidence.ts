import type { EngineWarning, FactSet, InferenceSet } from "./types";

// Confidence formula (deterministic, documented, deliberately simple):
//
//   overallConfidence = clamp01( mean(confidence of every populated fact/inference) - (0.05 * groundingWarningCount) )
//
// - Only fields with a non-null value contribute to the mean — unknowns are
//   excluded entirely, not treated as zero (an engine that mostly says "I
//   don't know" should not be penalized for honesty the same way one that
//   guesses wrong should be).
// - If nothing is populated at all, overallConfidence is 0 — there is
//   nothing to be confident about.
// - A provider-supplied overallConfidence is never an input to this
//   function and is never trusted — this is the only place overallConfidence
//   is computed.
// - Each grounding warning (code starting with "GROUNDING_") subtracts a
//   flat penalty. This is on top of the per-field confidence reductions
//   grounding-validator.ts already applies to individual fields — it exists
//   because a result with many small grounding problems should read as less
//   trustworthy overall, even if each individual field's own confidence
//   already absorbed part of the hit.
// - GROUNDING_WARNING_PENALTY is the one constant to change if this needs
//   tuning later.
export const GROUNDING_WARNING_PENALTY = 0.05;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function computeOverallConfidence(
  facts: FactSet,
  inferences: InferenceSet,
  warnings: EngineWarning[],
): number {
  const scored: number[] = [];

  for (const fact of Object.values(facts)) {
    if (fact.value !== null) {
      scored.push(fact.confidence);
    }
  }

  for (const inference of Object.values(inferences)) {
    if (inference.value !== null) {
      scored.push(inference.confidence);
    }
  }

  const base = scored.length === 0 ? 0 : scored.reduce((sum, confidence) => sum + confidence, 0) / scored.length;

  const groundingWarningCount = warnings.filter((warning) => warning.code.startsWith("GROUNDING_")).length;
  const penalty = groundingWarningCount * GROUNDING_WARNING_PENALTY;

  return clamp01(base - penalty);
}
