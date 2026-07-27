import { describe, expect, it } from "vitest";
import { createMockAIProvider } from "@/server/intelligence/testing/mock-ai-provider";
import { classifyRelationship } from "../relationship-classifier";

const INPUT = { newStatement: "El TRAVO cuesta S/450.", existingStatement: "El TRAVO cuesta S/500." };

describe("classifyRelationship", () => {
  it("returns the parsed classification on a valid response", async () => {
    const mock = createMockAIProvider({
      knowledgeExtractionResponse: JSON.stringify({ classification: "CONTRADICTORY", confidence: 0.85 }),
    });

    const result = await classifyRelationship(INPUT, mock.provider);

    expect(result).toEqual({ classification: "CONTRADICTORY", confidence: 0.85 });
    expect(mock.getKnowledgeExtractionCallCount()).toBe(1);
  });

  it("returns null (never throws) for malformed JSON", async () => {
    const mock = createMockAIProvider({ knowledgeExtractionResponse: "not json" });
    const result = await classifyRelationship(INPUT, mock.provider);
    expect(result).toBeNull();
  });

  it("returns null (never throws) for JSON that doesn't match the schema", async () => {
    const mock = createMockAIProvider({ knowledgeExtractionResponse: JSON.stringify({ wrong: "shape" }) });
    const result = await classifyRelationship(INPUT, mock.provider);
    expect(result).toBeNull();
  });

  it("returns null (never throws) when the provider call itself fails", async () => {
    const mock = createMockAIProvider({ knowledgeExtractionThrowError: new Error("network down") });
    const result = await classifyRelationship(INPUT, mock.provider);
    expect(result).toBeNull();
  });

  it("returns null when the provider has no knowledgeExtraction capability", async () => {
    const provider = { name: "bare", modelName: "x", capabilities: {} };
    const result = await classifyRelationship(INPUT, provider);
    expect(result).toBeNull();
  });
});
