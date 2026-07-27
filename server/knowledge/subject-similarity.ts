// Lexical similarity — the v1 duplicate/conflict shortlist mechanism
// (Sprint 8 review, item 5). No embeddings/vector search exist anywhere in
// this codebase yet (confirmed in the Sprint 8 audit); this is a deliberate,
// dependency-free v1 that a future embeddings-based v2 can replace without
// changing anything downstream of buildShortlist's callers — it's a
// candidate-GENERATION mechanism, not semantic truth, exactly as specified.

const DIACRITICS = /[̀-ͯ]/g;

export function normalizeKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): Set<string> {
  const normalized = normalizeKey(text);
  return new Set(normalized.length > 0 ? normalized.split(" ") : []);
}

/** 0 (no overlap) to 1 (identical token sets after normalization). */
export function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}
