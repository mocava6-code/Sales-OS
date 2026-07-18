import { describe, expect, it } from "vitest";
import { computeOverallConfidence, GROUNDING_WARNING_PENALTY } from "../confidence";
import type {
  AiPriority,
  BuyingIntent,
  Compatibility,
  CustomerType,
  EngineWarning,
  EstimatedDealValue,
  Fact,
  FactSet,
  Inference,
  InferenceSet,
  RecommendedAction,
  Sentiment,
} from "../types";

function fact<T>(value: T | null, confidence = 0): Fact<T> {
  return { kind: "fact", value, confidence, evidence: [] };
}

function inference<T>(value: T | null, confidence = 0): Inference<T> {
  return { kind: "inference", value, confidence, evidence: [] };
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

describe("computeOverallConfidence", () => {
  it("returns 0 when nothing is populated", () => {
    expect(computeOverallConfidence(emptyFactSet(), emptyInferenceSet(), [])).toBe(0);
  });

  it("excludes null/unknown fields from the average", () => {
    const facts = emptyFactSet();
    facts.vehicleBrand = fact("Toyota", 0.8);
    facts.vehicleModel = fact("Hilux", 0.6);
    // Every other fact stays null and must not pull the average down.

    const result = computeOverallConfidence(facts, emptyInferenceSet(), []);
    expect(result).toBeCloseTo(0.7); // mean(0.8, 0.6)
  });

  it("averages across both facts and inferences", () => {
    const facts = emptyFactSet();
    facts.vehicleBrand = fact("Toyota", 1);
    const inferences = emptyInferenceSet();
    inferences.sentiment = inference("POSITIVE", 0);

    const result = computeOverallConfidence(facts, inferences, []);
    expect(result).toBeCloseTo(0.5); // mean(1, 0)
  });

  it("applies a flat penalty per grounding warning", () => {
    const facts = emptyFactSet();
    facts.vehicleBrand = fact("Toyota", 0.9);

    const warnings: EngineWarning[] = [
      { code: "GROUNDING_NO_VALID_EVIDENCE", message: "x", severity: "warning" },
      { code: "GROUNDING_PARTIAL_EVIDENCE", message: "y", severity: "warning" },
    ];

    const result = computeOverallConfidence(facts, emptyInferenceSet(), warnings);
    expect(result).toBeCloseTo(0.9 - 2 * GROUNDING_WARNING_PENALTY);
  });

  it("ignores non-grounding warnings for the penalty", () => {
    const facts = emptyFactSet();
    facts.vehicleBrand = fact("Toyota", 0.9);

    const warnings: EngineWarning[] = [{ code: "SOMETHING_ELSE", message: "x", severity: "info" }];

    const result = computeOverallConfidence(facts, emptyInferenceSet(), warnings);
    expect(result).toBeCloseTo(0.9);
  });

  it("clamps at 0 rather than going negative", () => {
    const facts = emptyFactSet();
    facts.vehicleBrand = fact("Toyota", 0.05);

    const warnings: EngineWarning[] = Array.from({ length: 10 }, () => ({
      code: "GROUNDING_NO_VALID_EVIDENCE",
      message: "x",
      severity: "warning" as const,
    }));

    expect(computeOverallConfidence(facts, emptyInferenceSet(), warnings)).toBe(0);
  });
});
