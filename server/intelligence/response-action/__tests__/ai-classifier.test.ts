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

describe("classifyConversationActionWithAI — explicit decline safety override (Phase 5 production finding)", () => {
  // Confirmed against a REAL Groq production call during Phase 5
  // evaluation: given "lo lamento pero no quiero", the model returned
  // NO_ACTION_REQUIRED at 0.9 confidence — exactly the dangerous call
  // deterministic-classifier.ts was designed to never make. Prompt
  // wording alone wasn't a reliable enough guarantee, so this is now also
  // enforced in code, regardless of what the model returns.
  const declineContext = context({ recentEntries: [{ id: "entry-1", direction: "INBOUND", content: "lo lamento pero no quiero", occurredAt: new Date("2026-08-01T00:00:00Z") }] });

  it("overrides a confident NO_ACTION_REQUIRED to UNCERTAIN when the message is an explicit decline", async () => {
    const mock = createMockAIProvider({
      response: jsonResponse({ actionState: "NO_ACTION_REQUIRED", reasonCode: "CUSTOMER_DECLINED", confidence: 0.9, reasoning: "Customer declined.", evidenceEntryIds: ["entry-1"], recommendedAction: null }),
    });

    const result = await classifyConversationActionWithAI(declineContext, { aiProvider: mock.provider });

    expect(result.actionState).toBe("UNCERTAIN");
    expect(result.source).toBe("AI");
  });

  it("overrides a confident WAITING_ON_CUSTOMER to UNCERTAIN when the message is an explicit decline", async () => {
    const mock = createMockAIProvider({
      response: jsonResponse({ actionState: "WAITING_ON_CUSTOMER", reasonCode: "WAITING_FOR_CUSTOMER_DECISION", confidence: 0.9, reasoning: "Ball is elsewhere.", evidenceEntryIds: ["entry-1"], recommendedAction: null }),
    });

    const result = await classifyConversationActionWithAI(declineContext, { aiProvider: mock.provider });

    expect(result.actionState).toBe("UNCERTAIN");
  });

  it("does NOT override REPLY_REQUIRED for the same decline — only NO_ACTION_REQUIRED/WAITING_ON_CUSTOMER are dangerous here", async () => {
    const mock = createMockAIProvider({
      response: jsonResponse({ actionState: "REPLY_REQUIRED", reasonCode: "CUSTOMER_OBJECTION", confidence: 0.9, reasoning: "Save-the-sale opportunity.", evidenceEntryIds: ["entry-1"], recommendedAction: "Offer an alternative." }),
    });

    const result = await classifyConversationActionWithAI(declineContext, { aiProvider: mock.provider });

    expect(result.actionState).toBe("REPLY_REQUIRED");
  });

  it("does not trigger the override for an unrelated message with no decline language", async () => {
    const mock = createMockAIProvider({
      response: jsonResponse({ actionState: "NO_ACTION_REQUIRED", reasonCode: "CUSTOMER_CLOSING_ACKNOWLEDGEMENT", confidence: 0.9, reasoning: "Polite closing.", evidenceEntryIds: ["entry-1"], recommendedAction: null }),
    });

    const result = await classifyConversationActionWithAI(context(), { aiProvider: mock.provider }); // default context: "¿Tienen disponible en rojo?"

    expect(result.actionState).toBe("NO_ACTION_REQUIRED");
  });

  it("checks the LAST inbound message, not an earlier one, for decline language", async () => {
    const laterQuestionContext = context({
      recentEntries: [
        { id: "entry-1", direction: "INBOUND", content: "no quiero el kit rojo", occurredAt: new Date("2026-08-01T00:00:00Z") },
        { id: "entry-2", direction: "OUTBOUND", content: "Entendido, ¿le interesa en negro?", occurredAt: new Date("2026-08-01T00:05:00Z") },
        { id: "entry-3", direction: "INBOUND", content: "Sí, ese sí me interesa", occurredAt: new Date("2026-08-01T00:10:00Z") },
      ],
    });
    const mock = createMockAIProvider({
      response: jsonResponse({ actionState: "REPLY_REQUIRED", reasonCode: "BUYING_SIGNAL", confidence: 0.9, reasoning: "Interested in black.", evidenceEntryIds: ["entry-3"], recommendedAction: "Send black kit price." }),
    });

    const result = await classifyConversationActionWithAI(laterQuestionContext, { aiProvider: mock.provider });

    expect(result.actionState).toBe("REPLY_REQUIRED"); // never touched — the override only inspects the most recent inbound message
  });
});

describe("classifyConversationActionWithAI — no-readable-text safety override (Phase 5 production finding)", () => {
  // Confirmed against a REAL Groq production call during Phase 5
  // evaluation: given a bare "[unsupported message type: reaction]"
  // placeholder (no real text — see message-normalizer.ts), the model
  // returned NO_ACTION_REQUIRED / CONVERSATION_NOT_COMMERCIAL at 0.9
  // confidence. There's no actual customer text to ground that claim in.
  it.each(["[image]", "[document]", "[audio]", "[video]", "[sticker]", "[unsupported message type: reaction]", "[unsupported message type: unsupported]"])(
    'overrides a confident NO_ACTION_REQUIRED to UNCERTAIN for content-less message "%s"',
    async (content) => {
      const mediaContext = context({ recentEntries: [{ id: "entry-1", direction: "INBOUND", content, occurredAt: new Date("2026-08-01T00:00:00Z") }] });
      const mock = createMockAIProvider({
        response: jsonResponse({ actionState: "NO_ACTION_REQUIRED", reasonCode: "CONVERSATION_NOT_COMMERCIAL", confidence: 0.9, reasoning: "Not commercial.", evidenceEntryIds: ["entry-1"], recommendedAction: null }),
      });

      const result = await classifyConversationActionWithAI(mediaContext, { aiProvider: mock.provider });

      expect(result.actionState).toBe("UNCERTAIN");
    },
  );

  it("does NOT override WAITING_ON_CUSTOMER for a content-less message — only the NO_ACTION_REQUIRED claim is unsafe here", async () => {
    const mediaContext = context({ recentEntries: [{ id: "entry-1", direction: "INBOUND", content: "[sticker]", occurredAt: new Date("2026-08-01T00:00:00Z") }] });
    const mock = createMockAIProvider({
      response: jsonResponse({ actionState: "WAITING_ON_CUSTOMER", reasonCode: "WAITING_FOR_CUSTOMER_DECISION", confidence: 0.9, reasoning: "Nothing further owed.", evidenceEntryIds: ["entry-1"], recommendedAction: null }),
    });

    const result = await classifyConversationActionWithAI(mediaContext, { aiProvider: mock.provider });

    expect(result.actionState).toBe("WAITING_ON_CUSTOMER");
  });

  it("does not trigger for a real caption that happens to be wrapped in brackets", async () => {
    const captionedContext = context({ recentEntries: [{ id: "entry-1", direction: "INBOUND", content: "[Precio especial hoy]", occurredAt: new Date("2026-08-01T00:00:00Z") }] });
    const mock = createMockAIProvider({
      response: jsonResponse({ actionState: "NO_ACTION_REQUIRED", reasonCode: "CUSTOMER_CLOSING_ACKNOWLEDGEMENT", confidence: 0.9, reasoning: "Closing.", evidenceEntryIds: ["entry-1"], recommendedAction: null }),
    });

    const result = await classifyConversationActionWithAI(captionedContext, { aiProvider: mock.provider });

    expect(result.actionState).toBe("NO_ACTION_REQUIRED"); // not an exact match against the known placeholder set — left untouched
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
