import { z } from "zod";
import { LOST_REASONS } from "@/lib/validations/outcome";

// Runtime validation for the Fase C AI layer's raw output — same strict,
// bounded-vocabulary convention as server/intelligence/response-action/schema.ts.
export const outcomeSuggestionOutputSchema = z
  .object({
    suggestedOutcomeType: z.enum(["SALE_CLOSED", "SALE_LOST", "NOT_AN_OPPORTUNITY", "UNCERTAIN"]),
    suggestedLostReason: z.enum(LOST_REASONS).nullable(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().min(1).max(300),
  })
  .strict();

export type OutcomeSuggestionOutput = z.infer<typeof outcomeSuggestionOutputSchema>;
