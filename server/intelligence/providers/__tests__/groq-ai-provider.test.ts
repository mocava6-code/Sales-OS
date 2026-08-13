import { describe, expect, it } from "vitest";
import type { AIProvider } from "../../ai-provider";
import { classifyConversationActionWithAI } from "../../response-action/ai-classifier";
import type { ConversationActionContext } from "../../response-action/types";
import { MalformedProviderOutputError, ModelProviderError } from "../../errors";
import { createGroqClient } from "../../../kori/groq-client";
import { KoriProviderRateLimitedError } from "../../../kori/errors";
import { createMockAIProvider } from "../../testing/mock-ai-provider";
import { createGroqAIProvider, GroqEmptyResponseError } from "../groq-ai-provider";

function conversationAnalysisOf(provider: AIProvider) {
  const capability = provider.capabilities.conversationAnalysis;
  if (!capability) throw new Error("Test setup error: provider has no conversationAnalysis capability.");
  return capability;
}

function baseContext(): ConversationActionContext {
  return {
    conversationId: "conv-1",
    leadId: "lead-1",
    observedStatus: "NEEDS_REPLY",
    lastEntryDirection: "INBOUND",
    lastEntryAt: new Date("2026-08-01T00:00:00Z"),
    recentEntries: [{ id: "e1", direction: "INBOUND", content: "K kit es?", occurredAt: new Date("2026-08-01T00:00:00Z") }],
    structural: { leadNextAction: null, hasOverdueFollowUp: false, hasPendingFollowUp: false },
  };
}

function buildMinimalValidResponseActionJson() {
  return JSON.stringify({
    actionState: "REPLY_REQUIRED",
    reasonCode: "CUSTOMER_QUESTION",
    confidence: 0.8,
    reasoning: "Customer asked which kit this is.",
    evidenceEntryIds: ["e1"],
    recommendedAction: null,
  });
}

describe("createGroqAIProvider — output cleanup (unit, no network, no API key)", () => {
  it("passes through a clean JSON response unchanged", async () => {
    const json = buildMinimalValidResponseActionJson();
    const groqClient = createGroqClient({ model: "test-groq-model", sendMessage: async () => json });
    const provider = createGroqAIProvider({ groqClient });

    const response = await conversationAnalysisOf(provider).complete({ systemPrompt: "s", userPrompt: "u", responseSchemaName: "x" });
    expect(response.rawText).toBe(json);
  });

  it("strips a markdown code fence around the JSON", async () => {
    const json = buildMinimalValidResponseActionJson();
    const groqClient = createGroqClient({ model: "test-groq-model", sendMessage: async () => "```json\n" + json + "\n```" });
    const provider = createGroqAIProvider({ groqClient });

    const response = await conversationAnalysisOf(provider).complete({ systemPrompt: "s", userPrompt: "u", responseSchemaName: "x" });
    expect(response.rawText).toBe(json);
  });

  it("extracts JSON surrounded by safely-strippable prose", async () => {
    const json = buildMinimalValidResponseActionJson();
    const groqClient = createGroqClient({ model: "test-groq-model", sendMessage: async () => `Here is the analysis:\n${json}\nHope this helps!` });
    const provider = createGroqAIProvider({ groqClient });

    const response = await conversationAnalysisOf(provider).complete({ systemPrompt: "s", userPrompt: "u", responseSchemaName: "x" });
    expect(response.rawText).toBe(json);
  });

  it("throws GroqEmptyResponseError on an empty response", async () => {
    const groqClient = createGroqClient({ model: "test-groq-model", sendMessage: async () => "" });
    const provider = createGroqAIProvider({ groqClient });

    await expect(conversationAnalysisOf(provider).complete({ systemPrompt: "s", userPrompt: "u", responseSchemaName: "x" })).rejects.toBeInstanceOf(GroqEmptyResponseError);
  });

  it("does not crash on invalid JSON — returns it as-is for the pipeline to reject", async () => {
    const groqClient = createGroqClient({ model: "test-groq-model", sendMessage: async () => "{unquoted: key}" });
    const provider = createGroqAIProvider({ groqClient });

    const response = await conversationAnalysisOf(provider).complete({ systemPrompt: "s", userPrompt: "u", responseSchemaName: "x" });
    expect(response.rawText).toBe("{unquoted: key}");
  });

  it("propagates GroqClient's own typed errors (e.g. rate limiting) unwrapped", async () => {
    const groqClient = createGroqClient({
      model: "test-groq-model",
      sendMessage: async () => {
        throw new KoriProviderRateLimitedError("Groq rate limit exceeded (429).");
      },
    });
    const provider = createGroqAIProvider({ groqClient });

    await expect(conversationAnalysisOf(provider).complete({ systemPrompt: "s", userPrompt: "u", responseSchemaName: "x" })).rejects.toBeInstanceOf(KoriProviderRateLimitedError);
  });

  it("never requires an API key when sendMessage is injected", () => {
    expect(process.env.GROQ_API_KEY).toBeUndefined();
    const groqClient = createGroqClient({ model: "test-groq-model", sendMessage: async () => "{}" });
    expect(() => createGroqAIProvider({ groqClient })).not.toThrow();
  });

  it("the adapter's exported provider satisfies AIProvider with no extra Groq-shaped surface", async () => {
    const groqClient = createGroqClient({ model: "test-groq-model", sendMessage: async () => buildMinimalValidResponseActionJson() });
    const provider: AIProvider = createGroqAIProvider({ groqClient });

    const mock = createMockAIProvider({ response: buildMinimalValidResponseActionJson() });
    const swappable: AIProvider[] = [provider, mock.provider];
    for (const candidate of swappable) {
      const response = await conversationAnalysisOf(candidate).complete({ systemPrompt: "s", userPrompt: "u", responseSchemaName: "x" });
      expect(typeof response.rawText).toBe("string");
    }
  });
});

describe("createGroqAIProvider — end to end through classifyConversationActionWithAI", () => {
  it("classifies successfully through the full Semantic Response Intelligence AI path", async () => {
    const groqClient = createGroqClient({ model: "test-groq-model", sendMessage: async () => buildMinimalValidResponseActionJson() });
    const provider = createGroqAIProvider({ groqClient });

    const result = await classifyConversationActionWithAI(baseContext(), { aiProvider: provider });

    expect(result.actionState).toBe("REPLY_REQUIRED");
    expect(result.source).toBe("AI");
  });

  it("a Groq failure surfaces through the full pipeline as ModelProviderError", async () => {
    const groqClient = createGroqClient({
      model: "test-groq-model",
      sendMessage: async () => {
        throw new Error("network down");
      },
    });
    const provider = createGroqAIProvider({ groqClient });

    await expect(classifyConversationActionWithAI(baseContext(), { aiProvider: provider })).rejects.toBeInstanceOf(ModelProviderError);
  });

  it("a non-JSON refusal surfaces through the full pipeline as MalformedProviderOutputError", async () => {
    const groqClient = createGroqClient({ model: "test-groq-model", sendMessage: async () => "I can't help with that." });
    const provider = createGroqAIProvider({ groqClient });

    await expect(classifyConversationActionWithAI(baseContext(), { aiProvider: provider })).rejects.toBeInstanceOf(MalformedProviderOutputError);
  });

  it("records the correct provider name", () => {
    const groqClient = createGroqClient({ model: "llama-test-model", sendMessage: async () => "{}" });
    const provider = createGroqAIProvider({ groqClient });

    expect(provider.name).toBe("groq");
    expect(provider.modelName).toBe("llama-test-model");
  });
});
