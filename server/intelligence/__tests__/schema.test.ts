import { describe, expect, it } from "vitest";
import {
  conversationIntelligenceInputSchema,
  conversationIntelligenceResultSchema,
  objectionSignalSchema,
  providerResultSchema,
} from "../schema";
import type {
  BuyingIntent,
  Compatibility,
  ConversationIntelligenceResult,
  EstimatedDealValue,
  Evidence,
  Fact,
  Inference,
} from "../types";

const conversationEvidence = (excerpt: string): Evidence[] => [
  { sourceType: "conversation_message", sourceId: "msg-1", excerpt },
];

function fact<T>(value: T | null, evidence: Evidence[] = []): Fact<T> {
  return { kind: "fact", value, confidence: value === null ? 0 : 0.9, evidence };
}

function inference<T>(value: T | null, evidence: Evidence[] = [], reasoning?: string): Inference<T> {
  return { kind: "inference", value, confidence: value === null ? 0 : 0.7, evidence, reasoning };
}

function buildValidResult(): ConversationIntelligenceResult {
  return {
    metadata: {
      engineSchemaVersion: 1,
      promptVersion: "v1",
      modelProvider: "anthropic",
      modelName: "claude-sonnet-5",
      analyzedAt: new Date("2026-07-18T12:00:00Z"),
    },
    customerIdentification: {
      isExistingCustomer: false,
      matchedLeadId: null,
      matchConfidence: 0,
      matchEvidence: [],
    },
    facts: {
      customerName: fact("Juan Perez", conversationEvidence("Soy Juan Perez")),
      customerContact: fact("+52 55 1234 5678", conversationEvidence("+52 55 1234 5678")),
      vehicleBrand: fact("Toyota", conversationEvidence("tengo una Hilux")),
      vehicleModel: fact("Hilux", conversationEvidence("tengo una Hilux")),
      vehicleYear: fact(2022, conversationEvidence("del 2022")),
      city: fact<string>(null),
      quantity: fact(1, conversationEvidence("quiero una pieza")),
      productRequested: fact("body kit", conversationEvidence("quiero un body kit")),
    },
    inferences: {
      customerType: inference("RETAIL", conversationEvidence("quiero una pieza"), "single unit implies retail"),
      productFamily: inference("body_kit", conversationEvidence("quiero un body kit")),
      compatibility: inference<Compatibility>(null),
      buyingIntent: inference("READY_TO_BUY", conversationEvidence("cuando lo puedo recoger?")),
      sentiment: inference("POSITIVE", conversationEvidence("cuando lo puedo recoger?")),
      estimatedProbabilityOfPurchase: inference(0.7, conversationEvidence("cuando lo puedo recoger?")),
      estimatedDealValue: inference<EstimatedDealValue>(null),
      recommendedNextAction: inference(
        { action: "Send pricing", reason: "Customer is ready to buy and asked for pickup timing" },
        conversationEvidence("cuando lo puedo recoger?"),
      ),
      aiPriority: inference(
        { score: 80, label: "HIGH" },
        conversationEvidence("cuando lo puedo recoger?"),
        "ready-to-buy signal with no open objections",
      ),
    },
    objections: [],
    missingInformation: [{ field: "facts.city", reason: "not mentioned in conversation" }],
    warnings: [],
    draftResponse: {
      text: "¡Hola Juan! Claro, el body kit para tu Hilux 2022 está disponible.",
      evidence: conversationEvidence("tengo una Hilux del 2022"),
    },
    overallConfidence: 0.75,
  };
}

describe("conversationIntelligenceResultSchema", () => {
  it("accepts a fully valid result", () => {
    const result = conversationIntelligenceResultSchema.safeParse(buildValidResult());
    expect(result.success).toBe(true);
  });

  it("accepts an entirely unknown result — 'unknown' is a first-class, valid outcome", () => {
    const result = buildValidResult();
    result.facts.vehicleBrand = fact<string>(null);
    result.facts.vehicleModel = fact<string>(null);
    result.inferences.buyingIntent = inference<BuyingIntent>(null);
    result.overallConfidence = 0;

    const parsed = conversationIntelligenceResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it("rejects a populated fact with no evidence (grounding invariant)", () => {
    const result = buildValidResult();
    result.facts.vehicleBrand = { kind: "fact", value: "Ford", confidence: 0.9, evidence: [] };

    const parsed = conversationIntelligenceResultSchema.safeParse(result);
    expect(parsed.success).toBe(false);
  });

  it("rejects a populated inference with no evidence (grounding invariant)", () => {
    const result = buildValidResult();
    result.inferences.sentiment = { kind: "inference", value: "POSITIVE", confidence: 0.7, evidence: [] };

    const parsed = conversationIntelligenceResultSchema.safeParse(result);
    expect(parsed.success).toBe(false);
  });

  it("rejects confidence outside 0-1", () => {
    const result = buildValidResult();
    result.facts.vehicleYear.confidence = 1.5;

    const parsed = conversationIntelligenceResultSchema.safeParse(result);
    expect(parsed.success).toBe(false);
  });

  it("rejects an off-vocabulary enum value", () => {
    const result = buildValidResult();
    // @ts-expect-error deliberately invalid — enums must reject unknown vocabulary
    result.inferences.sentiment.value = "ANGRY";

    const parsed = conversationIntelligenceResultSchema.safeParse(result);
    expect(parsed.success).toBe(false);
  });

  it("rejects a fact object whose kind literal is 'inference'", () => {
    const result = buildValidResult();
    // @ts-expect-error deliberately wrong discriminant — a fact can never pass as an inference
    result.facts.vehicleBrand = { kind: "inference", value: "Ford", confidence: 0.9, evidence: conversationEvidence("x") };

    const parsed = conversationIntelligenceResultSchema.safeParse(result);
    expect(parsed.success).toBe(false);
  });
});

// Regression coverage for a real, confirmed production failure: Groq
// (model openai/gpt-oss-20b) returned "reasoning": null for every inference
// it had nothing to add for, instead of omitting the key. Zod's
// `.optional()` accepts a MISSING key but rejects an explicit `null` —
// providerResultSchema rejected every single one of these real responses
// with ProviderResultSchemaError issues like {"code":"invalid_type",
// "path":["inferences","customerType","reasoning"],"message":"Invalid
// input: expected string, received null"}. This is the confirmed reason
// Conversation Intelligence had a 0% success rate for the Koriaki pilot —
// see server/intelligence/schema.ts's inferenceSchema doc comment.
describe("providerResultSchema — reasoning: null (real Groq production shape)", () => {
  // Built directly from the actual raw response shape a Groq JSON-object-mode
  // completion for this prompt produces — not a synthetic minimal fixture.
  function realisticGroqProviderResult() {
    return {
      customerIdentification: { isExistingCustomer: false, matchedLeadId: null, matchConfidence: 0, matchEvidence: [] },
      facts: {
        customerName: { kind: "fact", value: null, confidence: 0, evidence: [] },
        customerContact: { kind: "fact", value: null, confidence: 0, evidence: [] },
        vehicleBrand: { kind: "fact", value: null, confidence: 0, evidence: [] },
        vehicleModel: {
          kind: "fact",
          value: "Hilux",
          confidence: 0.9,
          evidence: [{ sourceType: "conversation_message", sourceId: "message-1", excerpt: "Camioneta Hilux" }],
        },
        vehicleYear: {
          kind: "fact",
          value: 2017,
          confidence: 0.9,
          evidence: [{ sourceType: "conversation_message", sourceId: "message-2", excerpt: "Año 2017" }],
        },
        city: { kind: "fact", value: null, confidence: 0, evidence: [] },
        quantity: { kind: "fact", value: null, confidence: 0, evidence: [] },
        productRequested: { kind: "fact", value: null, confidence: 0, evidence: [] },
      },
      inferences: {
        // The three fields confirmed null-reasoning in the real production log.
        customerType: {
          kind: "inference",
          value: "RETAIL",
          confidence: 0.6,
          evidence: [{ sourceType: "conversation_message", sourceId: "message-5", excerpt: "Son cliente final" }],
          reasoning: null,
        },
        productFamily: { kind: "inference", value: null, confidence: 0, evidence: [], reasoning: null },
        // "unknown" as a null value (not the enum's own UNKNOWN member) —
        // a populated enum value would need evidence per the grounding
        // invariant, unrelated to what this fixture is testing.
        compatibility: { kind: "inference", value: null, confidence: 0, evidence: [], reasoning: null },
        // A mix of the other two valid shapes alongside the null ones —
        // proves all three (string / null / omitted) coexist correctly.
        buyingIntent: {
          kind: "inference",
          value: "EXPLORING",
          confidence: 0.4,
          evidence: [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "¿Qué tipo de vehículos se pueden convertir?" }],
          reasoning: "Preguntas exploratorias iniciales.",
        },
        sentiment: { kind: "inference", value: null, confidence: 0, evidence: [], reasoning: null },
        estimatedProbabilityOfPurchase: { kind: "inference", value: null, confidence: 0, evidence: [] }, // reasoning omitted entirely
        estimatedDealValue: { kind: "inference", value: null, confidence: 0, evidence: [] },
        recommendedNextAction: { kind: "inference", value: null, confidence: 0, evidence: [] },
        aiPriority: { kind: "inference", value: null, confidence: 0, evidence: [], reasoning: null },
      },
      objections: [],
      missingInformation: [{ field: "productRequested", reason: "not specified" }],
      warnings: [],
      draftResponse: null,
    };
  }

  it("accepts the real Groq response shape — reasoning: null on multiple inference fields", () => {
    const parsed = providerResultSchema.safeParse(realisticGroqProviderResult());
    expect(parsed.success).toBe(true);
  });

  it("accepts reasoning as a real string, explicit null, and an omitted key side by side in the same result", () => {
    const result = realisticGroqProviderResult();
    // Sanity-check the fixture actually exercises all three shapes.
    expect(result.inferences.customerType.reasoning).toBeNull();
    expect(result.inferences.buyingIntent.reasoning).toBe("Preguntas exploratorias iniciales.");
    expect("reasoning" in result.inferences.estimatedProbabilityOfPurchase).toBe(false);

    expect(providerResultSchema.safeParse(result).success).toBe(true);
  });

  it("the full assembled ConversationIntelligenceResult (provider output + engine metadata) still validates end to end with reasoning: null preserved", () => {
    const providerResult = realisticGroqProviderResult();
    const finalResult = {
      metadata: {
        engineSchemaVersion: 1,
        promptVersion: "kori-conversation-analysis-v1",
        modelProvider: "groq",
        modelName: "openai/gpt-oss-20b",
        analyzedAt: new Date("2026-08-13T18:05:00Z"),
      },
      ...providerResult,
      overallConfidence: 0.4,
    };

    const parsed = conversationIntelligenceResultSchema.safeParse(finalResult);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.inferences.customerType.reasoning).toBeNull();
    }
  });

  it("still rejects a genuinely malformed reasoning value — the relaxation is narrow, not a general loosening", () => {
    const result = realisticGroqProviderResult();
    // @ts-expect-error deliberately wrong type — a number was never a valid shape and must stay rejected
    result.inferences.sentiment.reasoning = 42;

    expect(providerResultSchema.safeParse(result).success).toBe(false);
  });

  it("still enforces the grounding invariant (populated inference needs evidence) — reasoning: null does not bypass it", () => {
    const result = realisticGroqProviderResult();
    result.inferences.customerType = { kind: "inference", value: "WHOLESALE", confidence: 0.6, evidence: [], reasoning: null };

    expect(providerResultSchema.safeParse(result).success).toBe(false);
  });

  it("still rejects a missing required field — reasoning's relaxation did not accidentally widen anything else", () => {
    const result = realisticGroqProviderResult();
    // @ts-expect-error deliberately missing required `confidence`
    delete result.inferences.productFamily.confidence;

    expect(providerResultSchema.safeParse(result).success).toBe(false);
  });
});

describe("objectionSignalSchema", () => {
  it("requires at least one evidence entry", () => {
    const parsed = objectionSignalSchema.safeParse({ objection: "price too high", confidence: 0.8, evidence: [] });
    expect(parsed.success).toBe(false);
  });

  it("accepts an objection with evidence", () => {
    const parsed = objectionSignalSchema.safeParse({
      objection: "price too high",
      confidence: 0.8,
      evidence: conversationEvidence("está muy caro"),
    });
    expect(parsed.success).toBe(true);
  });
});

describe("conversationIntelligenceInputSchema", () => {
  it("accepts input with only rawText", () => {
    const parsed = conversationIntelligenceInputSchema.safeParse({
      tenantId: "biz-1",
      channel: "manual",
      rawText: "Hola, tengo una Hilux 2022",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts input with only messages", () => {
    const parsed = conversationIntelligenceInputSchema.safeParse({
      tenantId: "biz-1",
      channel: "whatsapp",
      messages: [{ direction: "INBOUND", content: "Hola", occurredAt: new Date() }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects input with neither rawText nor messages", () => {
    const parsed = conversationIntelligenceInputSchema.safeParse({
      tenantId: "biz-1",
      channel: "manual",
    });
    expect(parsed.success).toBe(false);
  });
});
