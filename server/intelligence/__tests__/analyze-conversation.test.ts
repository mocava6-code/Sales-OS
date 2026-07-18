import { describe, expect, it } from "vitest";
import { analyzeConversation } from "../analyze-conversation";
import { conversationIntelligenceResultSchema } from "../schema";
import { createMockAIProvider } from "../testing/mock-ai-provider";
import {
  ChannelAdapterNotFoundError,
  InputValidationError,
  MalformedProviderOutputError,
  ModelProviderError,
  ProviderResultSchemaError,
} from "../errors";
import type { ConversationIntelligenceInput } from "../types";

const RAW_TEXT = "Tengo una Hilux del 2022\nOUT: Perfecto, cuéntame más";
// message-0 = "Tengo una Hilux del 2022" (INBOUND)
// message-1 = "Perfecto, cuéntame más" (OUTBOUND)

const baseInput: ConversationIntelligenceInput = {
  tenantId: "biz-1",
  channel: "manual",
  rawText: RAW_TEXT,
};

function buildValidProviderResult(overrides: Record<string, unknown> = {}) {
  return {
    customerIdentification: { isExistingCustomer: false, matchedLeadId: null, matchConfidence: 0, matchEvidence: [] },
    facts: {
      customerName: { kind: "fact", value: null, confidence: 0, evidence: [] },
      customerContact: { kind: "fact", value: null, confidence: 0, evidence: [] },
      vehicleBrand: {
        kind: "fact",
        value: "Toyota",
        confidence: 0.9,
        evidence: [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "Hilux" }],
      },
      vehicleModel: {
        kind: "fact",
        value: "Hilux",
        confidence: 0.9,
        evidence: [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "Hilux" }],
      },
      vehicleYear: {
        kind: "fact",
        value: 2022,
        confidence: 0.85,
        evidence: [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "2022" }],
      },
      city: { kind: "fact", value: null, confidence: 0, evidence: [] },
      quantity: { kind: "fact", value: null, confidence: 0, evidence: [] },
      productRequested: { kind: "fact", value: null, confidence: 0, evidence: [] },
    },
    inferences: {
      customerType: { kind: "inference", value: null, confidence: 0, evidence: [] },
      productFamily: { kind: "inference", value: null, confidence: 0, evidence: [] },
      compatibility: { kind: "inference", value: null, confidence: 0, evidence: [] },
      buyingIntent: {
        kind: "inference",
        value: "EXPLORING",
        confidence: 0.6,
        evidence: [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "Tengo una Hilux" }],
      },
      sentiment: {
        kind: "inference",
        value: "NEUTRAL",
        confidence: 0.6,
        evidence: [{ sourceType: "conversation_message", sourceId: "message-1", excerpt: "Perfecto" }],
      },
      estimatedProbabilityOfPurchase: { kind: "inference", value: null, confidence: 0, evidence: [] },
      estimatedDealValue: { kind: "inference", value: null, confidence: 0, evidence: [] },
      recommendedNextAction: {
        kind: "inference",
        value: { action: "Ask for city and quantity", reason: "Missing shipping details" },
        confidence: 0.7,
        evidence: [{ sourceType: "conversation_message", sourceId: "message-1", excerpt: "cuéntame más" }],
      },
      aiPriority: {
        kind: "inference",
        value: { score: 40, label: "MEDIUM" },
        confidence: 0.5,
        evidence: [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "Hilux" }],
      },
    },
    objections: [],
    missingInformation: [{ field: "facts.city", reason: "not mentioned" }],
    warnings: [],
    draftResponse: {
      text: "¡Hola! Contame en qué ciudad estás para darte el precio del kit para tu Hilux 2022.",
      evidence: [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "Hilux del 2022" }],
    },
    // Deliberately implausible — the pipeline must never trust this value.
    overallConfidence: 0.99,
    ...overrides,
  };
}

// mean(0.9, 0.9, 0.85, 0.6, 0.6, 0.7, 0.5) across the 7 populated fields above.
const EXPECTED_CONFIDENCE_ALL_GROUNDED = 0.7214285714285714;

describe("analyzeConversation — success paths", () => {
  it("1. runs the full pipeline end to end with valid mocked provider output", async () => {
    const mock = createMockAIProvider({ response: () => JSON.stringify(buildValidProviderResult()) });

    const result = await analyzeConversation(baseInput, { aiProvider: mock.provider });

    expect(result.facts.vehicleBrand.value).toBe("Toyota");
    expect(result.facts.vehicleModel.value).toBe("Hilux");
    expect(result.facts.city.value).toBeNull();
    expect(result.metadata.modelProvider).toBe("mock-provider");
    expect(result.metadata.engineSchemaVersion).toBe(1);
    expect(mock.getCallCount()).toBe(1);
  });

  it("6. passes through an entirely unknown result correctly", async () => {
    const allUnknown = buildValidProviderResult({
      facts: {
        customerName: { kind: "fact", value: null, confidence: 0, evidence: [] },
        customerContact: { kind: "fact", value: null, confidence: 0, evidence: [] },
        vehicleBrand: { kind: "fact", value: null, confidence: 0, evidence: [] },
        vehicleModel: { kind: "fact", value: null, confidence: 0, evidence: [] },
        vehicleYear: { kind: "fact", value: null, confidence: 0, evidence: [] },
        city: { kind: "fact", value: null, confidence: 0, evidence: [] },
        quantity: { kind: "fact", value: null, confidence: 0, evidence: [] },
        productRequested: { kind: "fact", value: null, confidence: 0, evidence: [] },
      },
      inferences: {
        customerType: { kind: "inference", value: null, confidence: 0, evidence: [] },
        productFamily: { kind: "inference", value: null, confidence: 0, evidence: [] },
        compatibility: { kind: "inference", value: null, confidence: 0, evidence: [] },
        buyingIntent: { kind: "inference", value: null, confidence: 0, evidence: [] },
        sentiment: { kind: "inference", value: null, confidence: 0, evidence: [] },
        estimatedProbabilityOfPurchase: { kind: "inference", value: null, confidence: 0, evidence: [] },
        estimatedDealValue: { kind: "inference", value: null, confidence: 0, evidence: [] },
        recommendedNextAction: { kind: "inference", value: null, confidence: 0, evidence: [] },
        aiPriority: { kind: "inference", value: null, confidence: 0, evidence: [] },
      },
      objections: [],
      missingInformation: [{ field: "facts.vehicleBrand", reason: "not mentioned" }],
      draftResponse: null,
    });
    const mock = createMockAIProvider({ response: () => JSON.stringify(allUnknown) });

    const result = await analyzeConversation(baseInput, { aiProvider: mock.provider });

    expect(result.overallConfidence).toBe(0);
    expect(result.warnings).toHaveLength(0);
    expect(conversationIntelligenceResultSchema.safeParse(result).success).toBe(true);
  });

  it("7. & 11. recalculates overallConfidence deterministically and ignores the provider's own value", async () => {
    const mock = createMockAIProvider({ response: () => JSON.stringify(buildValidProviderResult()) });

    const result = await analyzeConversation(baseInput, { aiProvider: mock.provider });

    expect(result.overallConfidence).not.toBeCloseTo(0.99, 2);
    expect(result.overallConfidence).toBeCloseTo(EXPECTED_CONFIDENCE_ALL_GROUNDED, 6);
  });

  it("9. feeds channel-normalized messages into the model prompt", async () => {
    const mock = createMockAIProvider({ response: () => JSON.stringify(buildValidProviderResult()) });

    await analyzeConversation(baseInput, { aiProvider: mock.provider });

    const lastRequest = mock.getLastRequest();
    expect(lastRequest?.userPrompt).toContain("[message-0] role=customer: Tengo una Hilux del 2022");
    expect(lastRequest?.userPrompt).toContain("[message-1] role=representative: Perfecto, cuéntame más");
  });

  it("10. works with no KnowledgeSource configured", async () => {
    const mock = createMockAIProvider({ response: () => JSON.stringify(buildValidProviderResult()) });

    const result = await analyzeConversation(baseInput, { aiProvider: mock.provider }); // no knowledgeSource

    expect(result.overallConfidence).toBeGreaterThan(0);
  });

  it("12. the final result always conforms to the public schema", async () => {
    const mock = createMockAIProvider({ response: () => JSON.stringify(buildValidProviderResult()) });
    const result = await analyzeConversation(baseInput, { aiProvider: mock.provider });

    expect(conversationIntelligenceResultSchema.parse(result)).toEqual(result);
  });
});

describe("analyzeConversation — grounding demotion reduces confidence", () => {
  it("5. & 8. demotes a field with an invalid evidence reference and reduces overallConfidence accordingly", async () => {
    const badEvidence = buildValidProviderResult({
      facts: {
        ...buildValidProviderResult().facts,
        vehicleYear: {
          kind: "fact",
          value: 2022,
          confidence: 0.85,
          // References a message that doesn't exist.
          evidence: [{ sourceType: "conversation_message", sourceId: "message-99", excerpt: "2022" }],
        },
      },
    });
    const mock = createMockAIProvider({ response: () => JSON.stringify(badEvidence) });

    const result = await analyzeConversation(baseInput, { aiProvider: mock.provider });

    expect(result.facts.vehicleYear.value).toBeNull();
    expect(result.warnings.some((w) => w.code === "GROUNDING_NO_VALID_EVIDENCE")).toBe(true);
    // mean(0.9, 0.9, 0.6, 0.6, 0.7, 0.5) = 0.7, minus one grounding-warning penalty (0.05) = 0.65
    expect(result.overallConfidence).toBeCloseTo(0.65, 6);
    expect(conversationIntelligenceResultSchema.safeParse(result).success).toBe(true);
  });
});

describe("analyzeConversation — error paths", () => {
  it("2. rejects invalid input before ever invoking the provider", async () => {
    const mock = createMockAIProvider({ response: () => JSON.stringify(buildValidProviderResult()) });
    const invalidInput = { tenantId: "biz-1", channel: "manual" } as ConversationIntelligenceInput; // no rawText, no messages

    await expect(analyzeConversation(invalidInput, { aiProvider: mock.provider })).rejects.toBeInstanceOf(
      InputValidationError,
    );
    expect(mock.getCallCount()).toBe(0);
  });

  it("3. converts a provider invocation failure into a typed ModelProviderError", async () => {
    const mock = createMockAIProvider({ throwError: new Error("network down") });

    const error = await analyzeConversation(baseInput, { aiProvider: mock.provider }).catch((e) => e);

    expect(error).toBeInstanceOf(ModelProviderError);
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.cause.message).toBe("network down");
  });

  it("4. converts malformed (non-JSON) provider output into a typed MalformedProviderOutputError", async () => {
    const mock = createMockAIProvider({ response: "{not valid json" });

    await expect(analyzeConversation(baseInput, { aiProvider: mock.provider })).rejects.toBeInstanceOf(
      MalformedProviderOutputError,
    );
  });

  it("converts schema-invalid (but syntactically valid JSON) provider output into a typed ProviderResultSchemaError", async () => {
    const mock = createMockAIProvider({ response: () => JSON.stringify({ nonsense: true }) });

    await expect(analyzeConversation(baseInput, { aiProvider: mock.provider })).rejects.toBeInstanceOf(
      ProviderResultSchemaError,
    );
  });

  it("throws a typed ChannelAdapterNotFoundError for a channel with no registered adapter", async () => {
    const mock = createMockAIProvider({ response: () => JSON.stringify(buildValidProviderResult()) });
    const input: ConversationIntelligenceInput = { tenantId: "biz-1", channel: "whatsapp", rawText: RAW_TEXT };

    await expect(analyzeConversation(input, { aiProvider: mock.provider })).rejects.toBeInstanceOf(
      ChannelAdapterNotFoundError,
    );
  });
});
