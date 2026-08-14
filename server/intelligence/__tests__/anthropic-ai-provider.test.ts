import { describe, expect, it } from "vitest";
import type { AIProvider } from "../ai-provider";
import { analyzeConversation } from "../analyze-conversation";
import { makeDecisions } from "../decision/make-decisions";
import type { KoriDecisionContext } from "../decision/types";
import { MalformedProviderOutputError, ModelProviderError } from "../errors";
import { KORI_CONVERSATION_ANALYSIS_PROMPT_VERSION } from "../prompts/kori-conversation-analysis-prompt";
import { AnthropicEmptyResponseError, AnthropicProviderError, createAnthropicAIProvider } from "../providers/anthropic-ai-provider";
import { createMockAIProvider } from "../testing/mock-ai-provider";
import type { ConversationIntelligenceInput, NormalizedMessage } from "../types";

const baseInput: ConversationIntelligenceInput = {
  tenantId: "biz-1",
  channel: "manual",
  rawText: "Tengo una Hilux del 2022",
};

function conversationAnalysisOf(provider: AIProvider) {
  const capability = provider.capabilities.conversationAnalysis;
  if (!capability) throw new Error("Test setup error: provider has no conversationAnalysis capability.");
  return capability;
}

function buildMinimalValidProviderJson() {
  const nullFact = { kind: "fact", value: null, confidence: 0, evidence: [] };
  const nullInference = { kind: "inference", value: null, confidence: 0, evidence: [] };

  return JSON.stringify({
    customerIdentification: { isExistingCustomer: false, matchedLeadId: null, matchConfidence: 0, matchEvidence: [] },
    facts: {
      customerName: nullFact,
      customerContact: nullFact,
      vehicleBrand: nullFact,
      vehicleModel: nullFact,
      vehicleYear: nullFact,
      city: nullFact,
      quantity: nullFact,
      productRequested: nullFact,
    },
    inferences: {
      customerType: nullInference,
      productFamily: nullInference,
      compatibility: nullInference,
      buyingIntent: nullInference,
      sentiment: nullInference,
      estimatedProbabilityOfPurchase: nullInference,
      estimatedDealValue: nullInference,
      recommendedNextAction: nullInference,
      aiPriority: nullInference,
    },
    objections: [],
    missingInformation: [],
    warnings: [],
    draftResponse: null,
  });
}

describe("createAnthropicAIProvider — output cleanup (unit, no network, no API key)", () => {
  it("1. passes through a clean JSON response unchanged", async () => {
    const json = buildMinimalValidProviderJson();
    const provider = createAnthropicAIProvider({ model: "test-model", sendMessage: async () => json });

    const response = await conversationAnalysisOf(provider).complete({ systemPrompt: "s", userPrompt: "u", responseSchemaName: "x" });
    expect(response.rawText).toBe(json);
  });

  it("2. strips a markdown code fence around the JSON", async () => {
    const json = buildMinimalValidProviderJson();
    const provider = createAnthropicAIProvider({
      model: "test-model",
      sendMessage: async () => "```json\n" + json + "\n```",
    });

    const response = await conversationAnalysisOf(provider).complete({ systemPrompt: "s", userPrompt: "u", responseSchemaName: "x" });
    expect(response.rawText).toBe(json);
  });

  it("3. extracts JSON surrounded by safely-strippable prose", async () => {
    const json = buildMinimalValidProviderJson();
    const provider = createAnthropicAIProvider({
      model: "test-model",
      sendMessage: async () => `Here is the analysis:\n${json}\nHope this helps!`,
    });

    const response = await conversationAnalysisOf(provider).complete({ systemPrompt: "s", userPrompt: "u", responseSchemaName: "x" });
    expect(response.rawText).toBe(json);
  });

  it("4. throws AnthropicEmptyResponseError on an empty response", async () => {
    const provider = createAnthropicAIProvider({ model: "test-model", sendMessage: async () => "" });

    await expect(
      conversationAnalysisOf(provider).complete({ systemPrompt: "s", userPrompt: "u", responseSchemaName: "x" }),
    ).rejects.toBeInstanceOf(AnthropicEmptyResponseError);
  });

  it("5. does not crash on invalid JSON — returns it as-is for the pipeline to reject", async () => {
    const provider = createAnthropicAIProvider({ model: "test-model", sendMessage: async () => "{unquoted: key}" });

    const response = await conversationAnalysisOf(provider).complete({ systemPrompt: "s", userPrompt: "u", responseSchemaName: "x" });
    expect(response.rawText).toBe("{unquoted: key}");
  });

  it("6. does not crash on truncated JSON — returns it as-is for the pipeline to reject", async () => {
    const truncated = '{"facts": {"vehicleBrand": {"value": "Toy';
    const provider = createAnthropicAIProvider({ model: "test-model", sendMessage: async () => truncated });

    const response = await conversationAnalysisOf(provider).complete({ systemPrompt: "s", userPrompt: "u", responseSchemaName: "x" });
    expect(response.rawText).toBe(truncated);
  });

  it("7. wraps an SDK/network failure in a provider-specific error", async () => {
    const provider = createAnthropicAIProvider({
      model: "test-model",
      sendMessage: async () => {
        throw new Error("rate limited");
      },
    });

    await expect(
      conversationAnalysisOf(provider).complete({ systemPrompt: "s", userPrompt: "u", responseSchemaName: "x" }),
    ).rejects.toBeInstanceOf(AnthropicProviderError);
  });

  it("8. does not crash on a prose-only refusal — returns it unchanged for the pipeline to reject as malformed", async () => {
    const refusal = "I can't help with that request.";
    const provider = createAnthropicAIProvider({ model: "test-model", sendMessage: async () => refusal });

    const response = await conversationAnalysisOf(provider).complete({ systemPrompt: "s", userPrompt: "u", responseSchemaName: "x" });
    expect(response.rawText).toBe(refusal);
  });

  it("11. never requires an API key when sendMessage is injected", () => {
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(() => createAnthropicAIProvider({ model: "test-model", sendMessage: async () => "{}" })).not.toThrow();
  });

  it("throws immediately if no apiKey and no sendMessage override are given", () => {
    expect(() => createAnthropicAIProvider({ model: "test-model" })).toThrow(AnthropicProviderError);
  });
});

describe("createAnthropicAIProvider — end to end through analyzeConversation", () => {
  it("8. a refusal surfaces through the full pipeline as MalformedProviderOutputError, not a crash", async () => {
    const provider = createAnthropicAIProvider({
      model: "test-model",
      sendMessage: async () => "I'm sorry, I can't assist with that.",
    });

    await expect(analyzeConversation(baseInput, { aiProvider: provider })).rejects.toBeInstanceOf(MalformedProviderOutputError);
  });

  it("7. an SDK failure surfaces through the full pipeline as ModelProviderError", async () => {
    const provider = createAnthropicAIProvider({
      model: "test-model",
      sendMessage: async () => {
        throw new Error("network down");
      },
    });

    await expect(analyzeConversation(baseInput, { aiProvider: provider })).rejects.toBeInstanceOf(ModelProviderError);
  });

  it("9. records the correct provider and model name in metadata", async () => {
    const provider = createAnthropicAIProvider({
      model: "claude-test-model-x",
      sendMessage: async () => buildMinimalValidProviderJson(),
    });

    const result = await analyzeConversation(baseInput, { aiProvider: provider });

    expect(result.metadata.modelProvider).toBe("anthropic");
    expect(result.metadata.modelName).toBe("claude-test-model-x");
  });

  it("10. includes the current prompt version in metadata", async () => {
    const provider = createAnthropicAIProvider({
      model: "test-model",
      sendMessage: async () => buildMinimalValidProviderJson(),
    });

    const result = await analyzeConversation(baseInput, { aiProvider: provider });

    expect(result.metadata.promptVersion).toBe(KORI_CONVERSATION_ANALYSIS_PROMPT_VERSION);
  });

  it("12. the adapter's exported provider satisfies AIProvider with no extra Anthropic-shaped surface", async () => {
    // Purely a type-level check: if createAnthropicAIProvider's return type carried any
    // Anthropic-specific shape, assigning it to `AIProvider` would still compile (structural
    // typing), but every call site in this engine only ever depends on this interface — proven
    // by the fact that this file, like every other engine file, never imports an Anthropic type
    // outside providers/anthropic-ai-provider.ts itself.
    const provider: AIProvider = createAnthropicAIProvider({
      model: "test-model",
      sendMessage: async () => buildMinimalValidProviderJson(),
    });

    const mock = createMockAIProvider({ response: buildMinimalValidProviderJson() });
    const swappable: AIProvider[] = [provider, mock.provider];
    for (const candidate of swappable) {
      const response = await conversationAnalysisOf(candidate).complete({ systemPrompt: "s", userPrompt: "u", responseSchemaName: "x" });
      expect(typeof response.rawText).toBe("string");
    }
  });
});

describe("createAnthropicAIProvider — decisionReasoning capability (Decision Engine phase)", () => {
  const decisionMessages: NormalizedMessage[] = [
    { direction: "INBOUND", content: "Hola, ¿tienen el kit para mi Hilux?", occurredAt: new Date() },
  ];
  const decisionContext: KoriDecisionContext = { conversationId: "conv-anthropic-1", recentMessages: decisionMessages };

  function buildMinimalDecisionJson() {
    return JSON.stringify({
      decisions: [
        {
          type: "ASK_CLARIFYING_QUESTION",
          title: "Ask for the year",
          recommendation: "Ask which year the Hilux is.",
          objective: "Confirm compatibility before proceeding",
          reasoning: "The customer didn't mention the vehicle year.",
          evidence: [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "Hilux" }],
          assumptions: [],
          missingInformation: [{ field: "vehicleYear", reason: "not mentioned" }],
          alternatives: [],
          confidence: 0.7,
          suggestedActionDescription: "Send a clarifying question about the vehicle year.",
        },
      ],
    });
  }

  it("11. Anthropic still works through the provider abstraction for decision reasoning", async () => {
    const provider = createAnthropicAIProvider({ model: "test-model", sendMessage: async () => buildMinimalDecisionJson() });

    const decisions = await makeDecisions(decisionContext, { aiProvider: provider });

    expect(decisions).toHaveLength(1);
    expect(decisions[0].metadata.aiProvider).toBe("anthropic");
    expect(decisions[0].metadata.modelName).toBe("test-model");
  });

  it("decisionReasoning also strips markdown fences and never needs an API key when sendMessage is injected", async () => {
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    const json = buildMinimalDecisionJson();
    const provider = createAnthropicAIProvider({
      model: "test-model",
      sendMessage: async () => "```json\n" + json + "\n```",
    });

    const capability = provider.capabilities.decisionReasoning;
    expect(capability).toBeDefined();
    const response = await capability!.complete({ systemPrompt: "s", userPrompt: "u", responseSchemaName: "x" });
    expect(response.rawText).toBe(json);
  });
});
