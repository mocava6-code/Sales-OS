import { describe, expect, it } from "vitest";
import { createMockAIProvider } from "@/server/intelligence/testing/mock-ai-provider";
import { extractKnowledgeCandidates, KORI_KNOWLEDGE_EXTRACTION_PROMPT_VERSION } from "../extract";
import {
  KnowledgeCapabilityNotSupportedError,
  KnowledgeModelProviderError,
  KnowledgeProviderResultSchemaError,
  MalformedKnowledgeProviderOutputError,
} from "../errors";
import type { ExtractionInput } from "../types";

const CONVERSATION_INPUT: ExtractionInput = {
  kind: "CONVERSATION",
  messages: [
    { id: "m0", role: "CUSTOMER", content: "¿El TRAVO sirve para mi Hilux 2018?", occurredAt: new Date(), evidenceRefType: "IMPORTED_MESSAGE", evidenceRefId: "msg-1" },
    { id: "m1", role: "BUSINESS", content: "Sí, el TRAVO sirve para Hilux Revo desde 2016.", occurredAt: new Date(), evidenceRefType: "IMPORTED_MESSAGE", evidenceRefId: "msg-2" },
  ],
};

function providerResult(candidates: unknown[]): string {
  return JSON.stringify({ candidates });
}

describe("extractKnowledgeCandidates — happy path", () => {
  it("calls the knowledgeExtraction capability and returns grounded candidates", async () => {
    const mock = createMockAIProvider({
      knowledgeExtractionResponse: providerResult([
        {
          class: "FACTUAL",
          proposedCategory: "COMPATIBILITY",
          subject: "Hilux TRAVO",
          statement: "Compatible con Hilux Revo desde 2016.",
          evidenceRefIndex: 1,
          evidenceQuote: "el TRAVO sirve para Hilux Revo desde 2016",
          confidence: 0.9,
        },
      ]),
    });

    const result = await extractKnowledgeCandidates(CONVERSATION_INPUT, { aiProvider: mock.provider });

    expect(mock.getKnowledgeExtractionCallCount()).toBe(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
    expect(result.extractorVersion).toBe(KORI_KNOWLEDGE_EXTRACTION_PROMPT_VERSION);
  });

  it("returns an empty result for a response with no candidates", async () => {
    const mock = createMockAIProvider({ knowledgeExtractionResponse: providerResult([]) });

    const result = await extractKnowledgeCandidates(CONVERSATION_INPUT, { aiProvider: mock.provider });

    expect(result.candidates).toHaveLength(0);
  });
});

describe("extractKnowledgeCandidates — error handling", () => {
  it("throws KnowledgeCapabilityNotSupportedError when the provider has no knowledgeExtraction capability", async () => {
    const provider = { name: "bare-provider", modelName: "x", capabilities: {} };

    await expect(extractKnowledgeCandidates(CONVERSATION_INPUT, { aiProvider: provider })).rejects.toBeInstanceOf(
      KnowledgeCapabilityNotSupportedError,
    );
  });

  it("wraps a provider failure in KnowledgeModelProviderError", async () => {
    const mock = createMockAIProvider({ knowledgeExtractionThrowError: new Error("network down") });

    await expect(extractKnowledgeCandidates(CONVERSATION_INPUT, { aiProvider: mock.provider })).rejects.toBeInstanceOf(
      KnowledgeModelProviderError,
    );
  });

  it("throws MalformedKnowledgeProviderOutputError for non-JSON output", async () => {
    const mock = createMockAIProvider({ knowledgeExtractionResponse: "not json at all" });

    await expect(extractKnowledgeCandidates(CONVERSATION_INPUT, { aiProvider: mock.provider })).rejects.toBeInstanceOf(
      MalformedKnowledgeProviderOutputError,
    );
  });

  it("throws KnowledgeProviderResultSchemaError for JSON that doesn't match the schema", async () => {
    const mock = createMockAIProvider({ knowledgeExtractionResponse: JSON.stringify({ wrong: "shape" }) });

    await expect(extractKnowledgeCandidates(CONVERSATION_INPUT, { aiProvider: mock.provider })).rejects.toBeInstanceOf(
      KnowledgeProviderResultSchemaError,
    );
  });
});

describe("extractKnowledgeCandidates — never persists an ungrounded candidate", () => {
  it("silently drops a candidate with fabricated (non-verbatim) evidence rather than throwing", async () => {
    const mock = createMockAIProvider({
      knowledgeExtractionResponse: providerResult([
        {
          class: "FACTUAL",
          proposedCategory: "COMPATIBILITY",
          subject: "Hilux TRAVO",
          statement: "Compatible con todo.",
          evidenceRefIndex: 1,
          evidenceQuote: "this text does not appear anywhere in the source",
          confidence: 0.9,
        },
      ]),
    });

    const result = await extractKnowledgeCandidates(CONVERSATION_INPUT, { aiProvider: mock.provider });

    expect(result.candidates).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
  });

  it("never emits a candidate for a customer-specific-shaped statement even if the model tries — dropped by category/grounding, not a special case", async () => {
    // Regression fixture straight from the Sprint 8 spec's own example.
    const input: ExtractionInput = {
      kind: "CONVERSATION",
      messages: [
        { id: "m0", role: "CUSTOMER", content: "Juan quiere entrega mañana.", occurredAt: new Date(), evidenceRefType: "IMPORTED_MESSAGE", evidenceRefId: "msg-1" },
      ],
    };
    // Simulates a misbehaving model trying to emit this anyway — grounding
    // still requires a real category+verbatim match, and the prompt itself
    // instructs against it; this proves the deterministic backstop, not the
    // prompt's wording, is what actually protects the Knowledge Base.
    const mock = createMockAIProvider({
      knowledgeExtractionResponse: providerResult([
        {
          class: "FACTUAL",
          proposedCategory: "DELIVERY", // not a real KnowledgeCategory value
          subject: "Juan",
          statement: "Juan quiere entrega mañana.",
          evidenceRefIndex: 0,
          evidenceQuote: "Juan quiere entrega mañana",
          confidence: 0.9,
        },
      ]),
    });

    const result = await extractKnowledgeCandidates(input, { aiProvider: mock.provider });

    expect(result.candidates).toHaveLength(0);
  });
});
