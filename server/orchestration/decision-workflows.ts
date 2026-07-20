// Advisor decision workflows — approve/reject/execute a proposed decision,
// or record that the advisor did something else entirely. All four share
// the same shape (read -> validate transition -> update status -> append
// event -> optionally append an AdvisorAction -> commit atomically), so
// they're all thin wrappers around one private helper.

import type { AdvisorActionRecord, DecisionEventType } from "../persistence/types";
import { assertDecisionStatusTransitionAllowed } from "./decision-status-policy";
import { DecisionNotFoundError } from "./errors";
import { runOrchestrationTransaction } from "./transaction";
import type {
  AdvisorActionInput,
  ApproveDecisionInput,
  DecisionWorkflowDependencies,
  DecisionWorkflowResult,
  ExecuteDecisionInput,
  RecordAdvisorOverrideInput,
  RejectDecisionInput,
} from "./types";
import type { DecisionStatus } from "../intelligence/decision/types";

interface TransitionRequest {
  decisionRecordId: string;
  toStatus: DecisionStatus;
  eventType: DecisionEventType;
  note?: string;
  advisorAction?: AdvisorActionInput;
}

async function transitionDecision(
  request: TransitionRequest,
  dependencies: DecisionWorkflowDependencies,
): Promise<DecisionWorkflowResult> {
  const now = dependencies.clock?.() ?? new Date();

  return runOrchestrationTransaction(dependencies.transactionRunner, async (uow) => {
    // 1. Read the current decision.
    const current = await uow.decisions.findById(request.decisionRecordId);
    if (!current) {
      throw new DecisionNotFoundError(request.decisionRecordId);
    }

    // 2. Validate that the transition is allowed.
    assertDecisionStatusTransitionAllowed(current.decision.status, request.toStatus);

    // 3. Update DecisionRecord.status.
    const updated = await uow.decisions.updateStatus(request.decisionRecordId, request.toStatus);

    // 4. Append the matching DecisionEvent.
    const event = await uow.decisionEvents.append({
      decisionRecordId: request.decisionRecordId,
      eventType: request.eventType,
      note: request.note,
      occurredAt: now,
    });

    // 5. Optionally append AdvisorAction.
    let advisorAction: AdvisorActionRecord | undefined;
    if (request.advisorAction) {
      advisorAction = await uow.advisorActions.record({
        decisionRecordId: request.decisionRecordId,
        actionType: request.advisorAction.actionType,
        advisorUserId: request.advisorAction.advisorUserId,
        notes: request.advisorAction.notes,
        occurredAt: now,
      });
    }

    return { decision: updated, event, advisorAction };
  });
}

/** PROPOSED -> APPROVED */
export function approveDecision(
  input: ApproveDecisionInput,
  dependencies: DecisionWorkflowDependencies,
): Promise<DecisionWorkflowResult> {
  return transitionDecision(
    {
      decisionRecordId: input.decisionRecordId,
      toStatus: "APPROVED",
      eventType: "APPROVED",
      note: input.note,
      advisorAction: input.advisorAction,
    },
    dependencies,
  );
}

/** PROPOSED -> REJECTED, or APPROVED -> REJECTED */
export function rejectDecision(
  input: RejectDecisionInput,
  dependencies: DecisionWorkflowDependencies,
): Promise<DecisionWorkflowResult> {
  return transitionDecision(
    {
      decisionRecordId: input.decisionRecordId,
      toStatus: "REJECTED",
      eventType: "REJECTED",
      note: input.note,
      advisorAction: input.advisorAction,
    },
    dependencies,
  );
}

/** APPROVED -> EXECUTED */
export function executeDecision(
  input: ExecuteDecisionInput,
  dependencies: DecisionWorkflowDependencies,
): Promise<DecisionWorkflowResult> {
  return transitionDecision(
    {
      decisionRecordId: input.decisionRecordId,
      toStatus: "EXECUTED",
      eventType: "EXECUTED",
      note: input.note,
      advisorAction: input.advisorAction,
    },
    dependencies,
  );
}

/**
 * The advisor did something other than what Kori recommended — ignored it,
 * partially followed it, or took a custom action. Distinct from
 * rejectDecision: an override is not a rejection — the advisor acted, just
 * not on Kori's recommendation — so the status lands on its own terminal
 * value, OVERRIDDEN, never REJECTED. The event is ADVISOR_OVERRIDDEN so what
 * happened instead stays reconstructable from history, and an AdvisorAction
 * is always recorded (never optional here, unlike the other three workflows).
 */
export function recordAdvisorOverride(
  input: RecordAdvisorOverrideInput,
  dependencies: DecisionWorkflowDependencies,
): Promise<DecisionWorkflowResult> {
  return transitionDecision(
    {
      decisionRecordId: input.decisionRecordId,
      toStatus: "OVERRIDDEN",
      eventType: "ADVISOR_OVERRIDDEN",
      note: input.notes,
      advisorAction: {
        actionType: input.actionType,
        advisorUserId: input.advisorUserId,
        notes: input.notes,
      },
    },
    dependencies,
  );
}
