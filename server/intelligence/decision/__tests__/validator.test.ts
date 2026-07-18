import { describe, expect, it } from "vitest";
import type { NormalizedMessage } from "../../types";
import type { CitableKnowledgeItem } from "../knowledge-items";
import type { CustomerProfileTraitProposal, DecisionProposal } from "../types";
import { validateCustomerProfileTraits, validateDecisionProposal, type DecisionGroundingContext } from "../validator";

const messages: NormalizedMessage[] = [
  { direction: "INBOUND", content: "Hola, ¿cuánto cuesta el body kit para mi Hilux?", occurredAt: new Date() },
  { direction: "OUTBOUND", content: "Claro, dame un momento para revisar.", occurredAt: new Date() },
];

const knowledgeItems: CitableKnowledgeItem[] = [
  { id: "known-product-fact:bodykit-hilux-price", content: "bodykit-hilux-price: 450 PEN" },
];

const context: DecisionGroundingContext = { messages, knowledgeItems };

function baseProposal(overrides: Partial<DecisionProposal> = {}): DecisionProposal {
  return {
    type: "RESPOND_TO_CUSTOMER",
    title: "Reply to customer",
    recommendation: "Say hello and confirm we received the question.",
    objective: "Keep the conversation moving",
    reasoning: "Customer asked a question and is waiting on a reply.",
    evidence: [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "cuánto cuesta" }],
    assumptions: [],
    missingInformation: [],
    alternatives: [],
    confidence: 0.7,
    suggestedActionDescription: "Send a short acknowledgement.",
    ...overrides,
  };
}

describe("validateDecisionProposal — grounding", () => {
  it("keeps evidence that is genuinely verifiable against a real message", () => {
    const { proposal, warnings } = validateDecisionProposal(baseProposal(), context);
    expect(proposal.evidence).toHaveLength(1);
    expect(warnings).toHaveLength(0);
  });

  it("drops evidence referencing a nonexistent message and warns", () => {
    const proposal = baseProposal({
      evidence: [{ sourceType: "conversation_message", sourceId: "message-99", excerpt: "cuánto cuesta" }],
    });
    const result = validateDecisionProposal(proposal, context);
    expect(result.proposal.evidence).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === "GROUNDING_PARTIAL_EVIDENCE")).toBe(true);
  });
});

describe("validateDecisionProposal — unsupported claims", () => {
  it("soft violation: mentioning price with no knowledge_item evidence adds missingInformation and forces escalation-worthy signal", () => {
    const proposal = baseProposal({
      recommendation: "Le decimos el precio del kit ahora mismo.",
      reasoning: "El cliente preguntó por el precio.",
    });
    const result = validateDecisionProposal(proposal, context);

    expect(result.hasUngroundedProtectedClaim).toBe(true);
    expect(result.proposal.missingInformation.some((m) => m.field === "price")).toBe(true);
    expect(result.warnings.some((w) => w.code === "UNSUPPORTED_CLAIM_CATEGORY")).toBe(true);
    expect(result.proposal.type).toBe("RESPOND_TO_CUSTOMER"); // soft violation does not retype
  });

  it("hard violation: a concrete fabricated price with no grounding is escalated automatically", () => {
    const proposal = baseProposal({
      recommendation: "El precio es $450 para tu Hilux.",
      reasoning: "El cliente preguntó por el precio del kit.",
    });
    const result = validateDecisionProposal(proposal, context);

    expect(result.proposal.type).toBe("ESCALATE_TO_HUMAN");
    expect(result.proposal.recommendation).not.toContain("$450");
    expect(result.hasUngroundedProtectedClaim).toBe(true);
    expect(result.warnings.some((w) => w.code === "UNSUPPORTED_DECISION_CLAIM" && w.severity === "error")).toBe(true);
  });

  it("a claim grounded in a verified knowledge_item is not treated as unsupported", () => {
    const proposal = baseProposal({
      recommendation: "El precio es 450 PEN según nuestra lista verificada.",
      reasoning: "El precio está confirmado en la ficha de producto.",
      evidence: [{ sourceType: "knowledge_item", sourceId: "known-product-fact:bodykit-hilux-price", excerpt: "450 PEN" }],
    });
    const result = validateDecisionProposal(proposal, context);

    expect(result.hasUngroundedProtectedClaim).toBe(false);
    expect(result.proposal.type).toBe("RESPOND_TO_CUSTOMER");
  });

  it("detects commercially risky framing (a promise) independent of protected categories", () => {
    const proposal = baseProposal({
      recommendation: "Te garantizo que este kit es el mejor del mercado.",
      evidence: [],
    });
    const result = validateDecisionProposal(proposal, context);
    expect(result.hasCommerciallyRiskyFraming).toBe(true);
  });
});

describe("validateCustomerProfileTraits", () => {
  const validTrait: CustomerProfileTraitProposal = {
    trait: "URGENT",
    confidence: 0.8,
    evidence: [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "cuánto cuesta" }],
    reasoning: "Asked directly about price early in the conversation.",
  };

  it("returns undefined when no traits were proposed", () => {
    const result = validateCustomerProfileTraits([], context);
    expect(result.profile).toBeUndefined();
  });

  it("keeps a grounded trait as an Inference, never a Fact", () => {
    const result = validateCustomerProfileTraits([validTrait], context);
    expect(result.profile?.traits).toHaveLength(1);
    expect(result.profile?.traits[0].kind).toBe("inference");
    expect(result.profile?.traits[0].value).toBe("URGENT");
    expect(result.profile?.traits[0].confidence).toBe(0.8);
    expect(result.profile?.traits[0].evidence).toHaveLength(1);
  });

  it("drops a trait with no verifiable evidence rather than keeping a bare null hypothesis", () => {
    const ungrounded: CustomerProfileTraitProposal = {
      trait: "DISTRUSTFUL",
      confidence: 0.6,
      evidence: [{ sourceType: "conversation_message", sourceId: "message-99", excerpt: "no confío" }],
    };
    const result = validateCustomerProfileTraits([ungrounded], context);
    expect(result.profile).toBeUndefined();
    expect(result.warnings.some((w) => w.code === "GROUNDING_NO_VALID_EVIDENCE")).toBe(true);
  });
});
