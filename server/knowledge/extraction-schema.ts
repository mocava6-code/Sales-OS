// Zod schema for the knowledge-extraction provider's raw JSON output, plus
// the category allow-lists used both here and in extraction-grounding.ts.
// Prisma-free (mirrors the Prisma KnowledgeCategory/BehaviorCategory enum
// VALUES without importing the Prisma client) — same discipline as
// server/knowledge/types.ts.

import { z } from "zod";

/** Mirrors the Prisma KnowledgeCategory enum's values exactly. */
export const FACTUAL_CATEGORIES = [
  "PRODUCT",
  "COMPATIBILITY",
  "OBJECTION",
  "COMMERCIAL_POLICY",
  "PROMOTION",
  "FAQ",
  "RECOMMENDED_RESPONSE",
  "LOGISTICS",
  "PRICING",
] as const;

/** Mirrors the Prisma BehaviorCategory enum's values exactly. */
export const BEHAVIOR_CATEGORIES = ["PROCESS_PATTERN", "SALES_BEHAVIOR", "CUSTOMER_PATTERN"] as const;

const candidateSchema = z
  .object({
    class: z.enum(["FACTUAL", "BEHAVIORAL"]),
    proposedCategory: z.string().min(1),
    subject: z.string().min(1),
    statement: z.string().min(1),
    // Index into the numbered transcript/sections the prompt showed the
    // model — resolved back to a concrete evidenceRefType/evidenceRefId by
    // extract.ts, never trusted as a free-text source id.
    evidenceRefIndex: z.number().int().nonnegative(),
    evidenceQuote: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })
  .passthrough();

export const knowledgeExtractionProviderResultSchema = z.object({
  candidates: z.array(candidateSchema),
});

export type KnowledgeExtractionProviderResult = z.infer<typeof knowledgeExtractionProviderResultSchema>;
export type KnowledgeExtractionProviderCandidate = z.infer<typeof candidateSchema>;
