import { describe, expect, it } from "vitest";
import {
  conversationIntelligenceInputSchema,
  conversationIntelligenceResultSchema,
  objectionSignalSchema,
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
