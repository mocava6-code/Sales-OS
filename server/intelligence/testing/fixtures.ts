// Minimal, fully-populated fixture builders for the two engine domain
// objects (ConversationIntelligenceResult, KoriDecision). Lives alongside
// mock-ai-provider.ts because both are shared test support consumed outside
// the engines' own suites — server/persistence/__tests__ and
// server/orchestration/__tests__ both need something realistic to
// round-trip/persist without re-running a real AI provider.

import type { ConversationIntelligenceResult } from "../types";
import type { KoriDecision } from "../decision/types";

export function buildConversationIntelligenceResult(
  overrides: Partial<ConversationIntelligenceResult> = {},
): ConversationIntelligenceResult {
  return {
    metadata: {
      engineSchemaVersion: 1,
      promptVersion: "kori-cie-v1",
      modelProvider: "anthropic",
      modelName: "claude-test",
      analyzedAt: new Date("2026-07-18T12:00:00.000Z"),
    },
    customerIdentification: {
      isExistingCustomer: false,
      matchedLeadId: null,
      matchConfidence: 0,
      matchEvidence: [],
    },
    facts: {
      customerName: { kind: "fact", value: "Juan", confidence: 0.9, evidence: [] },
      customerContact: { kind: "fact", value: null, confidence: 0, evidence: [] },
      vehicleBrand: { kind: "fact", value: "Toyota", confidence: 0.85, evidence: [] },
      vehicleModel: { kind: "fact", value: "Hilux", confidence: 0.85, evidence: [] },
      vehicleYear: { kind: "fact", value: 2022, confidence: 0.8, evidence: [] },
      city: { kind: "fact", value: null, confidence: 0, evidence: [] },
      quantity: { kind: "fact", value: 1, confidence: 0.7, evidence: [] },
      productRequested: { kind: "fact", value: "body kit", confidence: 0.75, evidence: [] },
    },
    inferences: {
      customerType: { kind: "inference", value: "RETAIL", confidence: 0.6, evidence: [] },
      productFamily: { kind: "inference", value: "body-kits", confidence: 0.6, evidence: [] },
      compatibility: { kind: "inference", value: "UNKNOWN", confidence: 0.4, evidence: [] },
      buyingIntent: { kind: "inference", value: "COMPARING", confidence: 0.55, evidence: [] },
      sentiment: { kind: "inference", value: "NEUTRAL", confidence: 0.65, evidence: [] },
      estimatedProbabilityOfPurchase: { kind: "inference", value: 0.5, confidence: 0.5, evidence: [] },
      estimatedDealValue: {
        kind: "inference",
        value: { amount: 450, currency: "USD" },
        confidence: 0.5,
        evidence: [],
      },
      recommendedNextAction: {
        kind: "inference",
        value: { action: "confirm compatibility", reason: "vehicle year unverified" },
        confidence: 0.5,
        evidence: [],
      },
      aiPriority: { kind: "inference", value: { score: 0.6, label: "MEDIUM" }, confidence: 0.6, evidence: [] },
    },
    objections: [],
    missingInformation: [{ field: "city", reason: "not mentioned yet" }],
    warnings: [],
    draftResponse: null,
    overallConfidence: 0.62,
    ...overrides,
  };
}

export function buildKoriDecision(overrides: Partial<KoriDecision> = {}): KoriDecision {
  return {
    id: "decision_fixture0000",
    type: "RESPOND_TO_CUSTOMER",
    title: "Confirm compatibility before quoting",
    recommendation: "Ask the customer to confirm the exact Hilux trim before quoting a price.",
    objective: "Avoid quoting an incompatible kit",
    reasoning: "Vehicle year and trim are not yet verified.",
    evidence: [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "Hilux 2022" }],
    assumptions: ["Customer is asking about the standard body kit line"],
    missingInformation: [{ field: "vehicleTrim", reason: "not mentioned yet" }],
    alternatives: [
      {
        title: "Quote the most common trim",
        recommendation: "Quote the base trim price and note it may change.",
        tradeoff: "Risks quoting an incompatible price.",
      },
    ],
    confidence: 0.7,
    riskLevel: "MEDIUM",
    impactLevel: "MEDIUM",
    approvalRequirement: "ADVISOR_APPROVAL_REQUIRED",
    suggestedAction: { description: "Ask for the exact trim.", autoPerformable: false },
    status: "PROPOSED",
    customerProfile: {
      traits: [{ kind: "inference", value: "COMPARISON_SHOPPING", confidence: 0.55, evidence: [] }],
    },
    warnings: [],
    metadata: {
      engineSchemaVersion: 1,
      promptVersion: "kori-decision-v1",
      aiProvider: "anthropic",
      modelName: "claude-test",
      decidedAt: new Date("2026-07-18T12:05:00.000Z"),
      conversationId: "conv-fixture",
      sourceConversationIntelligenceGeneratedAt: new Date("2026-07-18T12:00:00.000Z"),
    },
    ...overrides,
  };
}
