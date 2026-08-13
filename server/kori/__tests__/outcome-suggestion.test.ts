import { describe, expect, it } from "vitest";
import { suggestConversationOutcome } from "../outcome-suggestion";
import { createMockAIProvider } from "../../intelligence/testing/mock-ai-provider";
import type { OutcomeSuggestionConversationEntry } from "../outcome-suggestion-types";

const entries: OutcomeSuggestionConversationEntry[] = [
  { direction: "INBOUND", content: "Cuánto cuesta el kit TRAVO?", occurredAt: new Date("2026-08-01T10:00:00.000Z") },
  { direction: "OUTBOUND", content: "Cuesta 350 soles.", occurredAt: new Date("2026-08-01T10:05:00.000Z") },
];

function jsonResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return JSON.stringify({
    suggestedOutcomeType: "SALE_LOST",
    suggestedLostReason: "PRECIO",
    confidence: 0.85,
    reasoning: "El cliente preguntó el precio y no volvió a responder.",
    ...overrides,
  });
}

describe("suggestConversationOutcome", () => {
  it("returns null when no aiProvider is supplied (AI not configured)", async () => {
    const result = await suggestConversationOutcome(entries, {});
    expect(result).toBeNull();
  });

  it("returns null when entries is empty, without calling the provider", async () => {
    const mock = createMockAIProvider({ response: () => jsonResponse() });
    const result = await suggestConversationOutcome([], { aiProvider: mock.provider });
    expect(result).toBeNull();
    expect(mock.getCallCount()).toBe(0);
  });

  it("returns a suggestion for a confident SALE_LOST classification", async () => {
    const mock = createMockAIProvider({ response: () => jsonResponse() });
    const result = await suggestConversationOutcome(entries, { aiProvider: mock.provider });

    expect(result).toEqual({
      suggestedOutcomeType: "SALE_LOST",
      suggestedLostReason: "PRECIO",
      reasoning: "El cliente preguntó el precio y no volvió a responder.",
    });
  });

  it("returns null when the model itself says UNCERTAIN", async () => {
    const mock = createMockAIProvider({ response: () => jsonResponse({ suggestedOutcomeType: "UNCERTAIN", suggestedLostReason: null, confidence: 0.9 }) });
    const result = await suggestConversationOutcome(entries, { aiProvider: mock.provider });
    expect(result).toBeNull();
  });

  it("returns null when confidence is below the threshold, even for an otherwise valid suggestion", async () => {
    const mock = createMockAIProvider({ response: () => jsonResponse({ confidence: 0.5 }) });
    const result = await suggestConversationOutcome(entries, { aiProvider: mock.provider });
    expect(result).toBeNull();
  });

  it("returns null when SALE_LOST is suggested with no lostReason (schema requires one)", async () => {
    const mock = createMockAIProvider({ response: () => jsonResponse({ suggestedLostReason: null }) });
    const result = await suggestConversationOutcome(entries, { aiProvider: mock.provider });
    expect(result).toBeNull();
  });

  it("strips suggestedLostReason to null for a non-SALE_LOST suggestion, even if the model included one", async () => {
    const mock = createMockAIProvider({
      response: () => jsonResponse({ suggestedOutcomeType: "SALE_CLOSED", suggestedLostReason: "PRECIO", reasoning: "El cliente confirmó el pago." }),
    });
    const result = await suggestConversationOutcome(entries, { aiProvider: mock.provider });
    expect(result).toEqual({ suggestedOutcomeType: "SALE_CLOSED", suggestedLostReason: null, reasoning: "El cliente confirmó el pago." });
  });

  it("returns null on malformed (non-JSON) model output, never throwing", async () => {
    const mock = createMockAIProvider({ response: () => "not json at all" });
    const result = await suggestConversationOutcome(entries, { aiProvider: mock.provider });
    expect(result).toBeNull();
  });

  it("returns null when the model output fails schema validation, never throwing", async () => {
    const mock = createMockAIProvider({ response: () => JSON.stringify({ suggestedOutcomeType: "MAYBE" }) });
    const result = await suggestConversationOutcome(entries, { aiProvider: mock.provider });
    expect(result).toBeNull();
  });

  it("returns null when the provider throws, never propagating the error", async () => {
    const mock = createMockAIProvider({ throwError: new Error("Groq is down") });
    const result = await suggestConversationOutcome(entries, { aiProvider: mock.provider });
    expect(result).toBeNull();
  });
});
