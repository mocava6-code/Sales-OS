import { describe, expect, it } from "vitest";
import { outcomeSuggestionOutputSchema } from "../outcome-suggestion-schema";

function output(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    suggestedOutcomeType: "SALE_LOST",
    suggestedLostReason: "PRECIO",
    confidence: 0.85,
    reasoning: "El cliente preguntó el precio y no volvió a responder.",
    ...overrides,
  };
}

describe("outcomeSuggestionOutputSchema", () => {
  it("accepts a well-formed SALE_LOST suggestion", () => {
    expect(outcomeSuggestionOutputSchema.safeParse(output()).success).toBe(true);
  });

  it("accepts UNCERTAIN with a null lostReason", () => {
    const result = outcomeSuggestionOutputSchema.safeParse(output({ suggestedOutcomeType: "UNCERTAIN", suggestedLostReason: null }));
    expect(result.success).toBe(true);
  });

  it("rejects an unknown suggestedOutcomeType", () => {
    expect(outcomeSuggestionOutputSchema.safeParse(output({ suggestedOutcomeType: "MAYBE" })).success).toBe(false);
  });

  it("rejects an unknown suggestedLostReason", () => {
    expect(outcomeSuggestionOutputSchema.safeParse(output({ suggestedLostReason: "SE_ARREPINTIO" })).success).toBe(false);
  });

  it("rejects confidence outside [0,1]", () => {
    expect(outcomeSuggestionOutputSchema.safeParse(output({ confidence: 1.5 })).success).toBe(false);
    expect(outcomeSuggestionOutputSchema.safeParse(output({ confidence: -0.1 })).success).toBe(false);
  });

  it("rejects an empty reasoning", () => {
    expect(outcomeSuggestionOutputSchema.safeParse(output({ reasoning: "" })).success).toBe(false);
  });

  it("rejects reasoning longer than 300 characters", () => {
    expect(outcomeSuggestionOutputSchema.safeParse(output({ reasoning: "a".repeat(301) })).success).toBe(false);
  });

  it("rejects an unexpected extra key (strict schema)", () => {
    expect(outcomeSuggestionOutputSchema.safeParse({ ...output(), evidenceEntryIds: [] }).success).toBe(false);
  });
});
