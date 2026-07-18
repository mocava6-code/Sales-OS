import type { AIProvider } from "../ai-provider";
import { EngineInternalError, ModelProviderError } from "../errors";
import { CriticalInformationMissingError, DecisionReasoningUnavailableError, InvalidDecisionOutputError } from "./errors";
import { buildCitableKnowledgeItems } from "./knowledge-items";
import { evaluatePolicy } from "./policy-evaluator";
import { buildKoriDecisionPrompt, KORI_DECISION_PROMPT_VERSION } from "./prompts/kori-decision-prompt";
import { evaluateRisk } from "./risk-evaluator";
import { decisionReasoningOutputSchema, koriDecisionSchema } from "./schema";
import { DECISION_ENGINE_SCHEMA_VERSION, makeDecisionId } from "./types";
import type { KoriDecision, KoriDecisionContext } from "./types";
import { validateCustomerProfileTraits, validateDecisionProposal, type DecisionGroundingContext } from "./validator";

export interface DecisionPipelineDependencies {
  aiProvider: AIProvider;
}

/**
 * Runs the full Decision Engine pipeline against an already-shape-validated
 * context (light shape validation lives in make-decisions.ts). Never throws
 * anything but the typed errors in ./errors.ts and ../errors.ts.
 */
export async function runDecisionPipeline(
  context: KoriDecisionContext,
  dependencies: DecisionPipelineDependencies,
): Promise<KoriDecision[]> {
  // 1. Minimal-signal check — there must be *something* to reason about.
  if (!context.conversationIntelligence && !context.recentMessages?.length && !context.conversationSummary) {
    throw new CriticalInformationMissingError(
      `KoriDecisionContext for conversation "${context.conversationId}" has no conversationIntelligence, ` +
        "recentMessages, or conversationSummary — there is nothing to reason about yet.",
    );
  }

  // 2. Build the set of citable knowledge items (CI facts/inferences, known facts, business rules, prior interactions).
  const knowledgeItems = buildCitableKnowledgeItems(context);

  // 3. Resolve the capability.
  const decisionReasoning = dependencies.aiProvider.capabilities.decisionReasoning;
  if (!decisionReasoning) {
    throw new DecisionReasoningUnavailableError(dependencies.aiProvider.name);
  }

  // 4. Build the prompt.
  const request = buildKoriDecisionPrompt(context, knowledgeItems);

  // 5. Invoke.
  let rawText: string;
  try {
    const response = await decisionReasoning.complete(request);
    rawText = response.rawText;
  } catch (cause) {
    throw new ModelProviderError(
      `AI provider "${dependencies.aiProvider.name}" failed to complete the decision reasoning request.`,
      cause,
    );
  }

  // 6. Parse + schema validation.
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new InvalidDecisionOutputError(
      `AI provider "${dependencies.aiProvider.name}" returned decision reasoning output that is not valid JSON.`,
    );
  }

  const parseResult = decisionReasoningOutputSchema.safeParse(parsedJson);
  if (!parseResult.success) {
    throw new InvalidDecisionOutputError(
      `AI provider "${dependencies.aiProvider.name}" returned decision reasoning output that does not match the expected schema.`,
      parseResult.error.issues,
    );
  }
  const reasoningOutput = parseResult.data;

  // 7. Validate grounding for the customer profile and every proposed decision.
  const groundingContext: DecisionGroundingContext = { messages: context.recentMessages, knowledgeItems };

  const { profile: customerProfile } = validateCustomerProfileTraits(reasoningOutput.customerProfileTraits ?? [], groundingContext);

  const decisions: KoriDecision[] = reasoningOutput.decisions.map((rawProposal, index) => {
    const { proposal, warnings, hasUngroundedProtectedClaim, hasCommerciallyRiskyFraming } = validateDecisionProposal(
      rawProposal,
      groundingContext,
    );

    const { riskLevel, impactLevel } = evaluateRisk({
      type: proposal.type,
      hasUngroundedProtectedClaim,
      hasCommerciallyRiskyFraming,
    });

    const approvalRequirement = evaluatePolicy({
      type: proposal.type,
      riskLevel,
      impactLevel,
      missingInformation: proposal.missingInformation,
    });

    const decision: KoriDecision = {
      id: makeDecisionId(context.conversationId, proposal.type, index),
      type: proposal.type,
      title: proposal.title,
      recommendation: proposal.recommendation,
      objective: proposal.objective,
      reasoning: proposal.reasoning,
      evidence: proposal.evidence,
      assumptions: proposal.assumptions,
      missingInformation: proposal.missingInformation,
      alternatives: proposal.alternatives,
      confidence: proposal.confidence,
      riskLevel,
      impactLevel,
      approvalRequirement,
      suggestedAction: {
        description: proposal.suggestedActionDescription,
        autoPerformable: approvalRequirement === "AUTO_ALLOWED",
      },
      status: "PROPOSED",
      customerProfile,
      warnings,
      metadata: {
        engineSchemaVersion: DECISION_ENGINE_SCHEMA_VERSION,
        promptVersion: KORI_DECISION_PROMPT_VERSION,
        aiProvider: dependencies.aiProvider.name,
        modelName: dependencies.aiProvider.modelName,
        decidedAt: new Date(),
        conversationId: context.conversationId,
        sourceConversationIntelligenceGeneratedAt: context.conversationIntelligence?.metadata.analyzedAt,
      },
    };

    const finalCheck = koriDecisionSchema.safeParse(decision);
    if (!finalCheck.success) {
      throw new EngineInternalError(
        "The assembled KoriDecision did not conform to koriDecisionSchema.",
        finalCheck.error.issues,
      );
    }

    return finalCheck.data as KoriDecision;
  });

  return decisions;
}
