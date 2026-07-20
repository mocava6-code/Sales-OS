// Kori Commercial Orchestration v1 — the primary workflow.
//
// Coordinates the Conversation Intelligence Engine, the Decision Engine, and
// the persistence layer without either engine ever importing Prisma or a
// repository: both engines are called exactly the way their own test suites
// call them (analyzeConversation(input, deps), makeDecisions(context, deps)),
// and this module is the only thing that also knows about persistence.
//
// The two AI calls (steps 2 and 5) happen *before* any transaction opens —
// holding a DB transaction open across slow network calls is bad practice
// and unrelated to what the atomicity requirement is actually protecting
// (steps 3/6/7, the persistence writes). Only those three steps run inside
// one transaction.

import { analyzeConversation } from "../intelligence/analyze-conversation";
import { makeDecisions } from "../intelligence/decision/make-decisions";
import type { KoriDecision, KoriDecisionContext } from "../intelligence/decision/types";
import type { ConversationIntelligenceResult, EngineWarning } from "../intelligence/types";
import type { DecisionEventRecord, SavedDecisionRecord } from "../persistence/types";
import { ConversationAnalysisFailedError, DecisionGenerationFailedError } from "./errors";
import { runOrchestrationTransaction } from "./transaction";
import type {
  AnalyzeConversationAndCreateDecisionsDependencies,
  AnalyzeConversationAndCreateDecisionsInput,
  AnalyzeConversationAndCreateDecisionsResult,
} from "./types";

export async function analyzeConversationAndCreateDecisions(
  input: AnalyzeConversationAndCreateDecisionsInput,
  dependencies: AnalyzeConversationAndCreateDecisionsDependencies,
): Promise<AnalyzeConversationAndCreateDecisionsResult> {
  // 1-2. Receive conversation context (input.conversationIntelligenceInput)
  // and run the Conversation Intelligence Engine.
  let conversationIntelligence: ConversationIntelligenceResult;
  try {
    conversationIntelligence = await analyzeConversation(input.conversationIntelligenceInput, dependencies);
  } catch (cause) {
    throw new ConversationAnalysisFailedError(
      `Conversation Intelligence analysis failed for conversation "${input.conversationId}".`,
      cause,
    );
  }

  // 4. Build KoriDecisionContext — conversationId and conversationIntelligence
  // always come from this workflow, never from the caller-supplied overrides.
  const decisionContext: KoriDecisionContext = {
    ...input.decisionContext,
    conversationId: input.conversationId,
    conversationIntelligence,
  };

  // 5. Run the Decision Engine.
  let decisions: KoriDecision[];
  try {
    decisions = await makeDecisions(decisionContext, { aiProvider: dependencies.aiProvider });
  } catch (cause) {
    throw new DecisionGenerationFailedError(
      `Decision generation failed for conversation "${input.conversationId}".`,
      cause,
    );
  }

  // 3, 6, 7. Persist the snapshot, every decision, and a PROPOSED event per
  // decision — one atomic transaction. Any failure rolls all of it back.
  return runOrchestrationTransaction(dependencies.transactionRunner, async (uow) => {
    const snapshot = await uow.conversationSnapshots.save({
      businessId: input.businessId,
      conversationId: input.conversationId,
      result: conversationIntelligence,
    });

    const savedDecisions: SavedDecisionRecord[] = [];
    const events: DecisionEventRecord[] = [];

    for (const decision of decisions) {
      const savedDecision = await uow.decisions.save({
        businessId: input.businessId,
        conversationSnapshotId: snapshot.id,
        decision,
      });
      savedDecisions.push(savedDecision);

      const event = await uow.decisionEvents.append({
        decisionRecordId: savedDecision.id,
        eventType: "PROPOSED",
      });
      events.push(event);
    }

    const warnings: EngineWarning[] = [
      ...conversationIntelligence.warnings,
      ...savedDecisions.flatMap((d) => d.decision.warnings),
    ];

    return {
      conversationIntelligence,
      conversationSnapshotId: snapshot.id,
      decisions: savedDecisions,
      events,
      warnings,
    };
  });
}
