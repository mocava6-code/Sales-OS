// Pure unit tests (no DB, no real AI) — proves the AI layer's safety
// guarantees: grounding, confidence-thresholding, and typed-error behavior
// on failure. Uses the same createMockAIProvider fixture the Decision
// Engine's own tests use.

import { describe, expect, it } from "vitest";
import { AICapabilityNotSupportedError, MalformedProviderOutputError, ModelProviderError, ProviderResultSchemaError } from "../../errors";
import { createMockAIProvider } from "../../testing/mock-ai-provider";
import { AI_CONFIDENCE_THRESHOLD, classifyConversationActionWithAI } from "../ai-classifier";
import type { ConversationActionContext } from "../types";

function jsonResponse(value: unknown): string {
  return JSON.stringify(value);
}

function context(overrides: Partial<ConversationActionContext> = {}): ConversationActionContext {
  return {
    conversationId: "conv-1",
    leadId: "lead-1",
    observedStatus: "NEEDS_REPLY",
    lastEntryDirection: "INBOUND",
    lastEntryAt: new Date("2026-08-01T00:00:00Z"),
    recentEntries: [{ id: "entry-1", direction: "INBOUND", content: "¿Tienen disponible en rojo?", occurredAt: new Date("2026-08-01T00:00:00Z") }],
    structural: { leadNextAction: null, hasOverdueFollowUp: false, hasPendingFollowUp: false },
    ...overrides,
  };
}

const VALID_OUTPUT = {
  actionState: "REPLY_REQUIRED",
  reasonCode: "PRODUCT_AVAILABILITY",
  confidence: 0.9,
  reasoning: "Customer asked about color availability.",
  evidenceEntryIds: ["entry-1"],
  recommendedAction: "Confirm red availability.",
};

describe("classifyConversationActionWithAI — happy path", () => {
  it("returns the AI's classification when well-formed, grounded, and confident", async () => {
    const mock = createMockAIProvider({ response: jsonResponse(VALID_OUTPUT) });
    const result = await classifyConversationActionWithAI(context(), { aiProvider: mock.provider });

    expect(result).toEqual({
      actionState: "REPLY_REQUIRED",
      reasonCode: "PRODUCT_AVAILABILITY",
      confidence: 0.9,
      reasoning: "Customer asked about color availability.",
      evidenceEntryIds: ["entry-1"],
      recommendedAction: "Confirm red availability.",
      source: "AI",
    });
    expect(mock.getCallCount()).toBe(1);
  });

  it("invokes through the conversationAnalysis capability, not decisionReasoning", async () => {
    const mock = createMockAIProvider({ response: jsonResponse(VALID_OUTPUT), decisionReasoningResponse: jsonResponse([]) });
    await classifyConversationActionWithAI(context(), { aiProvider: mock.provider });
    expect(mock.getCallCount()).toBe(1);
    expect(mock.getDecisionReasoningCallCount()).toBe(0);
  });
});

describe("classifyConversationActionWithAI — grounding safety", () => {
  it("coerces to UNCERTAIN when an evidence id was never shown to the model", async () => {
    const mock = createMockAIProvider({ response: jsonResponse({ ...VALID_OUTPUT, evidenceEntryIds: ["entry-does-not-exist"] }) });
    const result = await classifyConversationActionWithAI(context(), { aiProvider: mock.provider });
    expect(result.actionState).toBe("UNCERTAIN");
    expect(result.reasonCode).toBe("UNCERTAIN_CONTEXT");
    expect(result.source).toBe("AI");
  });

  it("coerces to UNCERTAIN when a non-UNCERTAIN state cites zero evidence", async () => {
    const mock = createMockAIProvider({ response: jsonResponse({ ...VALID_OUTPUT, evidenceEntryIds: [] }) });
    const result = await classifyConversationActionWithAI(context(), { aiProvider: mock.provider });
    expect(result.actionState).toBe("UNCERTAIN");
  });

  it("UNCERTAIN with zero evidence entries is accepted as-is — UNCERTAIN never requires grounding", async () => {
    const mock = createMockAIProvider({
      response: jsonResponse({ actionState: "UNCERTAIN", reasonCode: "UNCERTAIN_CONTEXT", confidence: 0.9, reasoning: "Not enough context.", evidenceEntryIds: [], recommendedAction: null }),
    });
    const result = await classifyConversationActionWithAI(context(), { aiProvider: mock.provider });
    expect(result.actionState).toBe("UNCERTAIN");
  });
});

describe("classifyConversationActionWithAI — confidence threshold", () => {
  it(`coerces to UNCERTAIN when confidence is below ${AI_CONFIDENCE_THRESHOLD}`, async () => {
    const mock = createMockAIProvider({ response: jsonResponse({ ...VALID_OUTPUT, confidence: AI_CONFIDENCE_THRESHOLD - 0.01 }) });
    const result = await classifyConversationActionWithAI(context(), { aiProvider: mock.provider });
    expect(result.actionState).toBe("UNCERTAIN");
    expect(result.reasonCode).toBe("AMBIGUOUS_INTENT");
  });

  it("accepts a result exactly at the threshold", async () => {
    const mock = createMockAIProvider({ response: jsonResponse({ ...VALID_OUTPUT, confidence: AI_CONFIDENCE_THRESHOLD }) });
    const result = await classifyConversationActionWithAI(context(), { aiProvider: mock.provider });
    expect(result.actionState).toBe("REPLY_REQUIRED");
  });
});

describe("classifyConversationActionWithAI — failure modes throw typed errors", () => {
  it("throws AICapabilityNotSupportedError when the provider has no conversationAnalysis capability", async () => {
    const provider = { name: "no-analysis", modelName: "x", capabilities: {} };
    await expect(classifyConversationActionWithAI(context(), { aiProvider: provider })).rejects.toBeInstanceOf(AICapabilityNotSupportedError);
  });

  it("throws ModelProviderError when the provider call itself fails", async () => {
    const mock = createMockAIProvider({ throwError: new Error("network down") });
    await expect(classifyConversationActionWithAI(context(), { aiProvider: mock.provider })).rejects.toBeInstanceOf(ModelProviderError);
  });

  it("throws MalformedProviderOutputError on unparseable JSON", async () => {
    const mock = createMockAIProvider({ response: "{not valid json" });
    await expect(classifyConversationActionWithAI(context(), { aiProvider: mock.provider })).rejects.toBeInstanceOf(MalformedProviderOutputError);
  });

  it("throws ProviderResultSchemaError when the JSON doesn't match the schema", async () => {
    const mock = createMockAIProvider({ response: jsonResponse({ nonsense: true }) });
    await expect(classifyConversationActionWithAI(context(), { aiProvider: mock.provider })).rejects.toBeInstanceOf(ProviderResultSchemaError);
  });

  it("throws ProviderResultSchemaError on a hallucinated reasonCode outside the bounded enum", async () => {
    const mock = createMockAIProvider({ response: jsonResponse({ ...VALID_OUTPUT, reasonCode: "MADE_UP_CODE" }) });
    await expect(classifyConversationActionWithAI(context(), { aiProvider: mock.provider })).rejects.toBeInstanceOf(ProviderResultSchemaError);
  });

  it("throws ProviderResultSchemaError on an actionState outside the bounded enum (never lets free-form AI values become business logic)", async () => {
    const mock = createMockAIProvider({ response: jsonResponse({ ...VALID_OUTPUT, actionState: "MAYBE_REPLY" }) });
    await expect(classifyConversationActionWithAI(context(), { aiProvider: mock.provider })).rejects.toBeInstanceOf(ProviderResultSchemaError);
  });
});
