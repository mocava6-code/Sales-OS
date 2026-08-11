// Kori Natural Language Parsing v0 — deterministic pre-Groq safety guard.
//
// Groq's own strict-schema generation gate is NOT a reliable enforcement
// point: it can reject the model's own correct semantic judgment ("this is
// unsupported") purely because the model emitted the bare `{"unsupported":
// true}` sentinel instead of the full wire-format shape — a provider-side
// generation-compliance issue, not something a prompt can fully guarantee
// away (confirmed against repeated real production failures). So an
// obviously unsafe/unsupported request must never depend on either the
// model's prompt-following or Groq's generation gate behaving correctly.
// This module is the deterministic backstop: pure string matching, no
// network call, runs BEFORE Groq is ever invoked.
//
// Every pattern below requires a structural shape (a SQL statement shape,
// an exact injection phrase, an exact phrase for cross-tenant requests) —
// never a single common word — so an ordinary business question is never
// caught by accident. This is deliberately a narrow allowlist-adjacent
// blocklist, not a broad fuzzy filter: it only ever produces a FALSE
// POSITIVE by asking a real Kori operation to be phrased differently
// (acceptable — Kori has no mutation/cross-tenant/raw-SQL operation
// anyway, so rejecting a question shaped like one is never actually wrong,
// just conservative), never a false negative that lets something adversarial
// through un-checked.

import { UnsupportedKoriQuestionError } from "./errors";

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(the\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(all\s+)?(the\s+)?(previous|prior|above)\s+instructions/i,
  /\bsystem prompt\b/i,
  /\bdeveloper message\b/i,
  /ignora(r)?\s+(todas\s+)?(las\s+)?instrucciones\s+(anteriores|previas)/i,
];

// Structural SQL-statement shapes only — e.g. "select ... from", never the
// bare word "select" — so natural language never trips this.
const SQL_PATTERNS: RegExp[] = [
  /\bselect\b[\s\S]*\bfrom\b/i,
  /\binsert\s+into\b/i,
  /\bupdate\b[\s\S]*\bset\b/i,
  /\bdelete\s+from\b/i,
  /\bdrop\s+(table|database)\b/i,
  /\balter\s+table\b/i,
  /\btruncate\s+table\b/i,
  /\$queryraw\b/i,
  /\$executeraw\b/i,
];

const MUTATION_PATTERNS: RegExp[] = [
  /\bdelete\s+(all\s+)?leads?\b/i,
  /\bmodify\s+(the\s+)?database\b/i,
  /\bchange\s+customer\s+records?\b/i,
  /\b(create|update|remove)\s+records?\b/i,
  /\belimina(r)?\s+(todos\s+los\s+)?leads?\b/i,
  /\bborra(r)?\s+(todos\s+los\s+)?leads?\b/i,
];

const TENANT_ACCESS_PATTERNS: RegExp[] = [
  /\bgive me all businesses\b/i,
  /\btodos los negocios\b/i,
  /\bbusinessid\b/i,
  /\banother business('s)?\s+data\b/i,
];

const UNSAFE_QUESTION_PATTERNS: RegExp[] = [
  ...PROMPT_INJECTION_PATTERNS,
  ...SQL_PATTERNS,
  ...MUTATION_PATTERNS,
  ...TENANT_ACCESS_PATTERNS,
];

/**
 * Deterministic pre-Groq safety check — the FIRST thing
 * parseNaturalLanguageToKoriQuery does, before any network call. Throws
 * UnsupportedKoriQuestionError for a question matching an explicit,
 * structural unsafe pattern. A question that passes this check may still
 * be rejected later (by Groq's own sentinel, or by parseKoriQuerySpec) —
 * this guard only catches the obvious cases deterministically, it is not
 * the only safety layer.
 */
export function assertKoriQuestionAllowed(question: string): void {
  for (const pattern of UNSAFE_QUESTION_PATTERNS) {
    if (pattern.test(question)) {
      throw new UnsupportedKoriQuestionError("This question is not supported by Kori's query engine yet.");
    }
  }
}
