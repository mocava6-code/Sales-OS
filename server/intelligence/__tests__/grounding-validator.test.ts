import { describe, expect, it } from "vitest";
import { validateGrounding, type GroundingContext } from "../grounding-validator";
import type { ProviderResult } from "../schema";
import type {
  AiPriority,
  BuyingIntent,
  Compatibility,
  CustomerType,
  Evidence,
  EstimatedDealValue,
  Fact,
  FactSet,
  Inference,
  InferenceSet,
  NormalizedMessage,
  RecommendedAction,
  Sentiment,
} from "../types";

function fact<T>(value: T | null, evidence: Evidence[] = [], confidence = value === null ? 0 : 0.9): Fact<T> {
  return { kind: "fact", value, confidence, evidence };
}

function inference<T>(value: T | null, evidence: Evidence[] = [], confidence = value === null ? 0 : 0.9): Inference<T> {
  return { kind: "inference", value, confidence, evidence };
}

function emptyFactSet(): FactSet {
  return {
    customerName: fact<string>(null),
    customerContact: fact<string>(null),
    vehicleBrand: fact<string>(null),
    vehicleModel: fact<string>(null),
    vehicleYear: fact<number>(null),
    city: fact<string>(null),
    quantity: fact<number>(null),
    productRequested: fact<string>(null),
  };
}

function emptyInferenceSet(): InferenceSet {
  return {
    customerType: inference<CustomerType>(null),
    productFamily: inference<string>(null),
    compatibility: inference<Compatibility>(null),
    buyingIntent: inference<BuyingIntent>(null),
    sentiment: inference<Sentiment>(null),
    estimatedProbabilityOfPurchase: inference<number>(null),
    estimatedDealValue: inference<EstimatedDealValue>(null),
    recommendedNextAction: inference<RecommendedAction>(null),
    aiPriority: inference<AiPriority>(null),
  };
}

function baseProviderResult(): ProviderResult {
  return {
    customerIdentification: { isExistingCustomer: false, matchedLeadId: null, matchConfidence: 0, matchEvidence: [] },
    facts: emptyFactSet(),
    inferences: emptyInferenceSet(),
    objections: [],
    missingInformation: [],
    warnings: [],
    draftResponse: null,
  };
}

const messages: NormalizedMessage[] = [
  { direction: "INBOUND", content: "Tengo una Hilux del 2022", occurredAt: new Date() },
  { direction: "OUTBOUND", content: "Perfecto, cuéntame más", occurredAt: new Date() },
];

const context: GroundingContext = { messages, knowledgeSnippets: [] };

describe("validateGrounding", () => {
  it("keeps a fact whose evidence is a real substring of a real message", () => {
    const result = baseProviderResult();
    result.facts.vehicleModel = fact("Hilux", [
      { sourceType: "conversation_message", sourceId: "message-0", excerpt: "Hilux" },
    ]);

    const outcome = validateGrounding(result, context);
    expect(outcome.facts.vehicleModel.value).toBe("Hilux");
    expect(outcome.warnings).toHaveLength(0);
  });

  it("demotes a fact whose evidence references a nonexistent message", () => {
    const result = baseProviderResult();
    result.facts.vehicleModel = fact("Hilux", [
      { sourceType: "conversation_message", sourceId: "message-99", excerpt: "Hilux" },
    ]);

    const outcome = validateGrounding(result, context);
    expect(outcome.facts.vehicleModel.value).toBeNull();
    expect(outcome.facts.vehicleModel.confidence).toBe(0);
    expect(outcome.warnings.some((w) => w.code === "GROUNDING_NO_VALID_EVIDENCE")).toBe(true);
    expect(outcome.missingInformation.some((m) => m.field === "facts.vehicleModel")).toBe(true);
  });

  it("demotes a fact whose excerpt does not appear in the referenced message", () => {
    const result = baseProviderResult();
    result.facts.vehicleModel = fact("Ranger", [
      { sourceType: "conversation_message", sourceId: "message-0", excerpt: "Ranger" }, // message-0 mentions Hilux, not Ranger
    ]);

    const outcome = validateGrounding(result, context);
    expect(outcome.facts.vehicleModel.value).toBeNull();
  });

  it("reduces confidence proportionally when only some evidence is valid", () => {
    const result = baseProviderResult();
    result.facts.vehicleModel = fact(
      "Hilux",
      [
        { sourceType: "conversation_message", sourceId: "message-0", excerpt: "Hilux" },
        { sourceType: "conversation_message", sourceId: "message-99", excerpt: "Hilux" },
      ],
      0.8,
    );

    const outcome = validateGrounding(result, context);
    expect(outcome.facts.vehicleModel.value).toBe("Hilux");
    expect(outcome.facts.vehicleModel.evidence).toHaveLength(1);
    expect(outcome.facts.vehicleModel.confidence).toBeCloseTo(0.4); // 0.8 * (1 - 1/2)
    expect(outcome.warnings.some((w) => w.code === "GROUNDING_PARTIAL_EVIDENCE")).toBe(true);
  });

  it("never requires evidence for an already-unknown field", () => {
    const result = baseProviderResult(); // everything null
    const outcome = validateGrounding(result, context);
    expect(outcome.warnings).toHaveLength(0);
  });

  it("treats knowledge_item evidence as invalid when no snippets were retrieved", () => {
    const result = baseProviderResult();
    result.inferences.compatibility = inference("COMPATIBLE", [
      { sourceType: "knowledge_item", sourceId: "kb-1", excerpt: "fits Hilux" },
    ]);

    const outcome = validateGrounding(result, context); // context.knowledgeSnippets is []
    expect(outcome.inferences.compatibility.value).toBeNull();
  });

  it("treats customer_history evidence as always invalid in this phase", () => {
    const result = baseProviderResult();
    result.customerIdentification = {
      isExistingCustomer: true,
      matchedLeadId: "lead-1",
      matchConfidence: 0.9,
      matchEvidence: [{ sourceType: "customer_history", sourceId: "lead-1", excerpt: "prior purchase" }],
    };

    const outcome = validateGrounding(result, context);
    expect(outcome.customerIdentification.isExistingCustomer).toBe(false);
    expect(outcome.customerIdentification.matchedLeadId).toBeNull();
  });

  it("drops an objection with no valid evidence entirely", () => {
    const result = baseProviderResult();
    result.objections = [
      { objection: "price too high", confidence: 0.7, evidence: [{ sourceType: "conversation_message", sourceId: "message-99", excerpt: "caro" }] },
    ];

    const outcome = validateGrounding(result, context);
    expect(outcome.objections).toHaveLength(0);
  });

  it("keeps an objection whose evidence is valid", () => {
    const result = baseProviderResult();
    result.objections = [
      {
        objection: "wants more info",
        confidence: 0.7,
        evidence: [{ sourceType: "conversation_message", sourceId: "message-1", excerpt: "cuéntame más" }],
      },
    ];

    const outcome = validateGrounding(result, context);
    expect(outcome.objections).toHaveLength(1);
  });

  it("nulls out a draftResponse with no valid evidence", () => {
    const result = baseProviderResult();
    result.draftResponse = {
      text: "Claro, el kit es compatible.",
      evidence: [{ sourceType: "conversation_message", sourceId: "message-99", excerpt: "compatible" }],
    };

    const outcome = validateGrounding(result, context);
    expect(outcome.draftResponse).toBeNull();
  });

  it("rejects an evidence entry with an empty excerpt", () => {
    const result = baseProviderResult();
    result.facts.city = fact("CDMX", [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "" }]);

    const outcome = validateGrounding(result, context);
    expect(outcome.facts.city.value).toBeNull();
  });
});
