// Shared between analyze-conversation-and-create-decisions.test.ts (mocked)
// and analyze-conversation-and-create-decisions.db.test.ts (gated, real
// Postgres) — raw JSON shapes an AIProvider is asked to return, valid
// against the engines' own schemas without needing to re-exercise their
// grounding logic (see the comment on minimalProviderResult below).

// A minimal, fully-null Conversation Intelligence provider response: valid
// against providerResultSchema (populated facts/inferences need evidence,
// null ones never do) and trivially grounded (nothing populated, nothing to
// ground) — deliberately avoids re-exercising the CIE's own grounding
// logic, which has its own test suite (server/intelligence/__tests__) that
// this phase leaves unchanged.
export function minimalProviderResult() {
  const nullFact = { kind: "fact", value: null, confidence: 0, evidence: [] };
  const nullInference = { kind: "inference", value: null, confidence: 0, evidence: [] };
  return {
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
    missingInformation: [{ field: "everything", reason: "test fixture" }],
    warnings: [],
    draftResponse: null,
  };
}

export function decisionProposal(title: string) {
  return {
    type: "ORGANIZE_CONVERSATION",
    title,
    recommendation: `Tag this conversation: ${title}.`,
    objective: "Keep the conversation organized",
    reasoning: "Test fixture reasoning.",
    evidence: [],
    assumptions: [],
    missingInformation: [],
    alternatives: [],
    confidence: 0.8,
    suggestedActionDescription: "Add an internal tag.",
  };
}
