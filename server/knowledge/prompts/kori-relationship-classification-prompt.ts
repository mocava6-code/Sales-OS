import type { ModelCompletionRequest } from "@/server/intelligence/capabilities";

// Bump whenever wording/schema changes — persisted on every
// KnowledgeCandidateRelationship.classifierVersion row this prompt produces.
export const KORI_RELATIONSHIP_CLASSIFICATION_PROMPT_VERSION = "kori-relationship-classification-v1";

const SYSTEM_PROMPT = `You are Kori's Knowledge Relationship Classifier for Koriaki Import. You are given
two short statements about the same general subject — a newly extracted candidate and an existing one
(which may already be approved organizational knowledge). Your only job is to classify how the NEW
statement relates to the EXISTING one.

Classify as exactly one of:
- "EQUIVALENT": both statements assert the same fact/claim, possibly worded differently.
- "CONTRADICTORY": the statements assert incompatible claims about the same specific thing (e.g.
  different prices for the same item, different year ranges for the same compatibility claim,
  opposite answers to the same question).
- "RELATED": both are about the same general subject but assert different, non-conflicting things
  (e.g. one is about price, the other about compatibility, for the same product).
- "UNRELATED": despite superficial subject overlap, they are not meaningfully about the same thing.

You never decide what happens as a result of your classification — you only classify. You never
rewrite, merge, approve, or invalidate either statement. If you are genuinely unsure between two
options, prefer the more conservative one: prefer CONTRADICTORY over EQUIVALENT when in doubt (a
false EQUIVALENT silently hides a real conflict from a human reviewer, which is worse than a false
CONTRADICTORY, which merely asks a human to look).

Return only one JSON object, nothing else:
{ "classification": "EQUIVALENT" | "CONTRADICTORY" | "RELATED" | "UNRELATED", "confidence": number }
confidence is 0 to 1.`;

export interface RelationshipClassificationInput {
  newStatement: string;
  existingStatement: string;
}

export function buildKoriRelationshipClassificationPrompt(input: RelationshipClassificationInput): ModelCompletionRequest {
  const userPrompt = [`New statement: ${input.newStatement}`, `Existing statement: ${input.existingStatement}`].join("\n");

  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    responseSchemaName: "RelationshipClassificationProviderResult",
  };
}
