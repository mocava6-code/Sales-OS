import { describe, expect, it } from "vitest";
import type { AIProvider } from "../../ai-provider";
import { InputValidationError, ModelProviderError } from "../../errors";
import type { NormalizedMessage } from "../../types";
import { createMockAIProvider } from "../../testing/mock-ai-provider";
import { CriticalInformationMissingError, DecisionReasoningUnavailableError, InvalidDecisionOutputError } from "../errors";
import { makeDecisions } from "../make-decisions";
import type { KoriDecisionContext } from "../types";

const messages: NormalizedMessage[] = [
  { direction: "INBOUND", content: "Hola, ¿cuánto cuesta el kit para mi Hilux 2022?", occurredAt: new Date() },
];

function baseContext(overrides: Partial<KoriDecisionContext> = {}): KoriDecisionContext {
  return {
    conversationId: "conv-1",
    recentMessages: messages,
    ...overrides,
  };
}

function jsonResponse(decisions: unknown[], customerProfileTraits?: unknown[]) {
  return JSON.stringify({ decisions, ...(customerProfileTraits ? { customerProfileTraits } : {}) });
}

describe("makeDecisions — success paths", () => {
  it("1. a low-risk, low-impact decision is AUTO_ALLOWED", async () => {
    const mock = createMockAIProvider({
      decisionReasoningResponse: jsonResponse([
        {
          type: "ORGANIZE_CONVERSATION",
          title: "Tag as pricing inquiry",
          recommendation: "Tag this conversation as a pricing inquiry for the Hilux kit line.",
          objective: "Keep the conversation organized",
          reasoning: "Customer asked a pricing question about a specific product line.",
          evidence: [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "cuánto cuesta" }],
          assumptions: [],
          missingInformation: [],
          alternatives: [],
          confidence: 0.85,
          suggestedActionDescription: "Add an internal tag.",
        },
      ]),
    });

    const decisions = await makeDecisions(baseContext(), { aiProvider: mock.provider });

    expect(decisions).toHaveLength(1);
    expect(decisions[0].riskLevel).toBe("LOW");
    expect(decisions[0].impactLevel).toBe("LOW");
    expect(decisions[0].approvalRequirement).toBe("AUTO_ALLOWED");
    expect(decisions[0].status).toBe("PROPOSED");
  });

  it("2. a high-impact strategy recommendation requires advisor approval", async () => {
    const mock = createMockAIProvider({
      decisionReasoningResponse: jsonResponse([
        {
          type: "RECOMMEND_SALES_APPROACH",
          title: "Shift to a consultative tone",
          recommendation: "Slow down and ask more open questions before proposing anything.",
          objective: "Build trust before proposing a next step",
          reasoning: "Customer has asked multiple questions without committing to any answer yet.",
          evidence: [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "cuánto cuesta" }],
          assumptions: [],
          missingInformation: [],
          alternatives: [],
          confidence: 0.6,
          suggestedActionDescription: "Advisor adjusts tone in the next reply.",
        },
      ]),
    });

    const decisions = await makeDecisions(baseContext(), { aiProvider: mock.provider });

    expect(decisions[0].impactLevel).toBe("HIGH");
    expect(decisions[0].approvalRequirement).toBe("ADVISOR_APPROVAL_REQUIRED");
  });

  it("3. an unverified price mention triggers HUMAN_INFORMATION_REQUIRED", async () => {
    const mock = createMockAIProvider({
      decisionReasoningResponse: jsonResponse([
        {
          type: "RESPOND_TO_CUSTOMER",
          title: "Answer the pricing question",
          recommendation: "Responder con el precio del kit para su Hilux.",
          objective: "Answer the customer's question",
          reasoning: "El cliente preguntó directamente por el precio.",
          evidence: [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "cuánto cuesta" }],
          assumptions: [],
          missingInformation: [],
          alternatives: [],
          confidence: 0.7,
          suggestedActionDescription: "Draft a reply once the price is confirmed.",
        },
      ]),
    });

    const decisions = await makeDecisions(baseContext(), { aiProvider: mock.provider });

    expect(decisions[0].missingInformation.some((m) => m.field === "price")).toBe(true);
    expect(decisions[0].approvalRequirement).toBe("HUMAN_INFORMATION_REQUIRED");
  });

  it("4. an unverified stock mention triggers HUMAN_INFORMATION_REQUIRED", async () => {
    const mock = createMockAIProvider({
      decisionReasoningResponse: jsonResponse([
        {
          type: "RESPOND_TO_CUSTOMER",
          title: "Answer the stock question",
          recommendation: "Confirmar la disponibilidad en stock antes de responder.",
          objective: "Answer the customer's question",
          reasoning: "El cliente quiere saber si hay stock disponible.",
          evidence: [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "cuánto cuesta" }],
          assumptions: [],
          missingInformation: [],
          alternatives: [],
          confidence: 0.7,
          suggestedActionDescription: "Check stock before replying.",
        },
      ]),
    });

    const decisions = await makeDecisions(baseContext(), { aiProvider: mock.provider });

    expect(decisions[0].missingInformation.some((m) => m.field === "stock")).toBe(true);
    expect(decisions[0].approvalRequirement).toBe("HUMAN_INFORMATION_REQUIRED");
  });

  it("5. a concrete unsupported claim is converted into an escalation, not silently dropped", async () => {
    const mock = createMockAIProvider({
      decisionReasoningResponse: jsonResponse([
        {
          type: "RESPOND_TO_CUSTOMER",
          title: "Answer with price and compatibility",
          recommendation: "El precio es $450 y sí, es compatible con tu Hilux.",
          objective: "Close the sale quickly",
          reasoning: "El cliente preguntó por precio y compatibilidad.",
          evidence: [],
          assumptions: [],
          missingInformation: [],
          alternatives: [],
          confidence: 0.9,
          suggestedActionDescription: "Send the price and compatibility confirmation.",
        },
      ]),
    });

    const decisions = await makeDecisions(baseContext(), { aiProvider: mock.provider });

    expect(decisions).toHaveLength(1);
    expect(decisions[0].type).toBe("ESCALATE_TO_HUMAN");
    expect(decisions[0].recommendation).not.toContain("$450");
    expect(decisions[0].warnings.some((w) => w.code === "UNSUPPORTED_DECISION_CLAIM")).toBe(true);
    expect(decisions[0].approvalRequirement).toBe("HUMAN_INFORMATION_REQUIRED");
  });

  it("6. the customer profile is an Inference, never a Fact", async () => {
    const mock = createMockAIProvider({
      decisionReasoningResponse: jsonResponse(
        [
          {
            type: "ASK_CLARIFYING_QUESTION",
            title: "Ask which product they mean",
            recommendation: "Ask which specific kit they're referring to.",
            objective: "Clarify before answering",
            reasoning: "The message is broad.",
            evidence: [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "cuánto cuesta" }],
            assumptions: [],
            missingInformation: [],
            alternatives: [],
            confidence: 0.7,
            suggestedActionDescription: "Send a clarifying question.",
          },
        ],
        [
          {
            trait: "URGENT",
            confidence: 0.75,
            evidence: [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "cuánto cuesta" }],
            reasoning: "Asked for a price immediately, first message.",
          },
        ],
      ),
    });

    const decisions = await makeDecisions(baseContext(), { aiProvider: mock.provider });

    expect(decisions[0].customerProfile?.traits[0].kind).toBe("inference");
    expect(decisions[0].customerProfile?.traits[0].value).toBe("URGENT");
    expect(decisions[0].customerProfile?.traits[0].confidence).toBe(0.75);
  });

  it("7. every decision includes evidence, confidence, and reasoning", async () => {
    const mock = createMockAIProvider({
      decisionReasoningResponse: jsonResponse([
        {
          type: "WAIT",
          title: "Wait for customer response",
          recommendation: "No further action needed right now.",
          objective: "Avoid unnecessary follow-up",
          reasoning: "The advisor already replied and the ball is in the customer's court.",
          evidence: [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "cuánto cuesta" }],
          assumptions: [],
          missingInformation: [],
          alternatives: [],
          confidence: 0.6,
          suggestedActionDescription: "No action.",
        },
      ]),
    });

    const decisions = await makeDecisions(baseContext(), { aiProvider: mock.provider });

    expect(decisions[0].evidence.length).toBeGreaterThan(0);
    expect(typeof decisions[0].confidence).toBe("number");
    expect(decisions[0].reasoning.length).toBeGreaterThan(0);
  });

  it("8. multiple alternatives can be returned", async () => {
    const mock = createMockAIProvider({
      decisionReasoningResponse: jsonResponse([
        {
          type: "FOLLOW_UP",
          title: "Schedule a follow-up",
          recommendation: "Follow up tomorrow morning.",
          objective: "Keep the conversation alive",
          reasoning: "Customer went quiet after asking about price.",
          evidence: [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "cuánto cuesta" }],
          assumptions: [],
          missingInformation: [],
          alternatives: [
            { title: "Follow up today", recommendation: "Follow up same day.", tradeoff: "Might feel pushy." },
            { title: "Wait two days", recommendation: "Give more space.", tradeoff: "Risks losing momentum." },
          ],
          confidence: 0.65,
          suggestedActionDescription: "Schedule a follow-up task.",
        },
      ]),
    });

    const decisions = await makeDecisions(baseContext(), { aiProvider: mock.provider });

    expect(decisions[0].alternatives).toHaveLength(2);
  });

  it("9. the mock provider is invoked through the decisionReasoning capability, not conversationAnalysis", async () => {
    const mock = createMockAIProvider({
      decisionReasoningResponse: jsonResponse([
        {
          type: "NO_ACTION",
          title: "Nothing to do",
          recommendation: "No action needed.",
          objective: "N/A",
          reasoning: "Conversation is already resolved.",
          evidence: [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "cuánto cuesta" }],
          assumptions: [],
          missingInformation: [],
          alternatives: [],
          confidence: 0.5,
          suggestedActionDescription: "None.",
        },
      ]),
    });

    await makeDecisions(baseContext(), { aiProvider: mock.provider });

    expect(mock.getDecisionReasoningCallCount()).toBe(1);
    expect(mock.getCallCount()).toBe(0); // conversationAnalysis must never be touched by the decision engine
  });
});

describe("makeDecisions — error paths", () => {
  it("throws InputValidationError for a context missing conversationId", async () => {
    const mock = createMockAIProvider({ decisionReasoningResponse: jsonResponse([]) });
    // @ts-expect-error deliberately invalid — conversationId is required
    await expect(makeDecisions({ recentMessages: messages }, { aiProvider: mock.provider })).rejects.toBeInstanceOf(
      InputValidationError,
    );
  });

  it("throws CriticalInformationMissingError before ever invoking the AI provider", async () => {
    const mock = createMockAIProvider({ decisionReasoningResponse: jsonResponse([]) });
    const emptyContext: KoriDecisionContext = { conversationId: "conv-empty" };

    await expect(makeDecisions(emptyContext, { aiProvider: mock.provider })).rejects.toBeInstanceOf(
      CriticalInformationMissingError,
    );
    expect(mock.getDecisionReasoningCallCount()).toBe(0);
  });

  it("throws DecisionReasoningUnavailableError when the provider doesn't support the capability", async () => {
    const provider: AIProvider = { name: "no-decisions", modelName: "x", capabilities: {} };

    await expect(makeDecisions(baseContext(), { aiProvider: provider })).rejects.toBeInstanceOf(
      DecisionReasoningUnavailableError,
    );
  });

  it("throws ModelProviderError when the underlying AI call fails", async () => {
    const mock = createMockAIProvider({ decisionReasoningThrowError: new Error("network down") });

    await expect(makeDecisions(baseContext(), { aiProvider: mock.provider })).rejects.toBeInstanceOf(ModelProviderError);
  });

  it("throws InvalidDecisionOutputError for non-JSON output", async () => {
    const mock = createMockAIProvider({ decisionReasoningResponse: "{not valid json" });

    await expect(makeDecisions(baseContext(), { aiProvider: mock.provider })).rejects.toBeInstanceOf(
      InvalidDecisionOutputError,
    );
  });

  it("throws InvalidDecisionOutputError for schema-invalid JSON", async () => {
    const mock = createMockAIProvider({ decisionReasoningResponse: JSON.stringify({ nonsense: true }) });

    await expect(makeDecisions(baseContext(), { aiProvider: mock.provider })).rejects.toBeInstanceOf(
      InvalidDecisionOutputError,
    );
  });
});
