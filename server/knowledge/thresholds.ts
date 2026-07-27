// Tunable thresholds for the reinforcement/conflict pipeline — isolated in
// one file so calibrating against Phase 10's real Koriaki conversation (and
// the koriakiimport.com crawl) doesn't require hunting through the pipeline
// logic itself.

/** Minimum subject-similarity to even consider two candidates/items as possibly related — builds the shortlist. */
export const SUBJECT_SHORTLIST_THRESHOLD = 0.6;

/** Statement-similarity at or above this is treated as EQUIVALENT without an LLM call. */
export const OBVIOUS_EQUIVALENCE_THRESHOLD = 0.9;

/** Statement-similarity below this is treated as not worth classifying at all — same subject, different aspect. */
export const OBVIOUS_UNRELATED_THRESHOLD = 0.15;
