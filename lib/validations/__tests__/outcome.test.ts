import { describe, expect, it } from "vitest";
import { recordConversationOutcomeSchema, suggestConversationOutcomeSchema } from "../outcome";

describe("recordConversationOutcomeSchema", () => {
  it("accepts SALE_CLOSED with no lostReason", () => {
    const result = recordConversationOutcomeSchema.safeParse({ conversationId: "conv-1", outcomeType: "SALE_CLOSED" });
    expect(result.success).toBe(true);
  });

  it("accepts NOT_AN_OPPORTUNITY with no extra fields", () => {
    const result = recordConversationOutcomeSchema.safeParse({ conversationId: "conv-1", outcomeType: "NOT_AN_OPPORTUNITY" });
    expect(result.success).toBe(true);
  });

  it("rejects SALE_LOST with no lostReason", () => {
    const result = recordConversationOutcomeSchema.safeParse({ conversationId: "conv-1", outcomeType: "SALE_LOST" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.lostReason?.[0]).toBe("Selecciona por qué se perdió la venta.");
    }
  });

  it("accepts SALE_LOST with a valid lostReason", () => {
    const result = recordConversationOutcomeSchema.safeParse({ conversationId: "conv-1", outcomeType: "SALE_LOST", lostReason: "PRECIO" });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown outcomeType", () => {
    const result = recordConversationOutcomeSchema.safeParse({ conversationId: "conv-1", outcomeType: "MAYBE" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown lostReason", () => {
    const result = recordConversationOutcomeSchema.safeParse({ conversationId: "conv-1", outcomeType: "SALE_LOST", lostReason: "SE_ARREPINTIO" });
    expect(result.success).toBe(false);
  });

  it("requires a conversationId", () => {
    const result = recordConversationOutcomeSchema.safeParse({ outcomeType: "SALE_CLOSED" });
    expect(result.success).toBe(false);
  });

  it("accepts optional productSold and notes", () => {
    const result = recordConversationOutcomeSchema.safeParse({
      conversationId: "conv-1",
      outcomeType: "SALE_CLOSED",
      productSold: "Kit TRAVO",
      notes: "Pagó al contado.",
    });
    expect(result.success).toBe(true);
  });
});

describe("suggestConversationOutcomeSchema", () => {
  it("accepts a bare conversationId", () => {
    expect(suggestConversationOutcomeSchema.safeParse({ conversationId: "conv-1" }).success).toBe(true);
  });

  it("rejects a missing conversationId", () => {
    expect(suggestConversationOutcomeSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an empty conversationId", () => {
    expect(suggestConversationOutcomeSchema.safeParse({ conversationId: "" }).success).toBe(false);
  });
});
