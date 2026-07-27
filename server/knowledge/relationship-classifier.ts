// The "optional grounded LLM relationship classification" step (Sprint 8
// review, item 5) — only ever invoked for the ambiguous middle ground
// reinforcement.ts's deterministic checks can't resolve on their own.
// Deliberately reuses the AIProvider's knowledgeExtraction capability
// (rather than adding a fifth named capability slot) — like
// conversationAnalysis/decisionReasoning, this is "raw prompt in, raw text
// out" with no vendor-specific behavior of its own, so a separate slot
// would add surface area without a real distinction.
//
// Returns null (never throws) on any failure — a failed classification for
// one shortlist comparison must never crash extraction for the rest of a
// conversation/document; reinforcement.ts simply skips recording a
// relationship for that pair when this returns null.

import { z } from "zod";
import type { AIProvider } from "@/server/intelligence/ai-provider";
import { buildKoriRelationshipClassificationPrompt, KORI_RELATIONSHIP_CLASSIFICATION_PROMPT_VERSION, type RelationshipClassificationInput } from "./prompts/kori-relationship-classification-prompt";

export { KORI_RELATIONSHIP_CLASSIFICATION_PROMPT_VERSION };

const relationshipResultSchema = z.object({
  classification: z.enum(["EQUIVALENT", "CONTRADICTORY", "RELATED", "UNRELATED"]),
  confidence: z.number().min(0).max(1),
});

export type RelationshipClassificationResult = z.infer<typeof relationshipResultSchema>;

export async function classifyRelationship(
  input: RelationshipClassificationInput,
  aiProvider: AIProvider,
): Promise<RelationshipClassificationResult | null> {
  const capability = aiProvider.capabilities.knowledgeExtraction;
  if (!capability) return null;

  try {
    const request = buildKoriRelationshipClassificationPrompt(input);
    const response = await capability.complete(request);
    const parsedJson = JSON.parse(response.rawText);
    const parsed = relationshipResultSchema.safeParse(parsedJson);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
