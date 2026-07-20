// Outcome workflows — the commercial result that followed a decision.
// Always append-only and chronological (see server/persistence/types.ts'
// Outcome/DecisionEvent domain types); nothing here ever updates a previous
// outcome or infers anything from the sequence — that's the Learning
// Engine's job, explicitly out of scope for this phase.
//
// Four of the seven outcome types have a corresponding DecisionEventType
// (CUSTOMER_REPLIED, FOLLOW_UP_SENT, SALE_CLOSED, SALE_LOST) and get both an
// Outcome and a DecisionEvent row; QUOTATION_REQUESTED, QUOTATION_SENT, and
// ABANDONED have no DecisionEventType counterpart and only ever produce an
// Outcome.

import type { DecisionEventRecord, DecisionEventType, OutcomeType } from "../persistence/types";
import { DecisionNotFoundError } from "./errors";
import { assertOutcomeRecordable } from "./outcome-attribution-policy";
import { runOrchestrationTransaction } from "./transaction";
import type { OutcomeWorkflowDependencies, OutcomeWorkflowResult, RecordOutcomeWorkflowInput } from "./types";

async function recordOutcome(
  outcomeType: OutcomeType,
  correspondingEventType: DecisionEventType | undefined,
  input: RecordOutcomeWorkflowInput,
  dependencies: OutcomeWorkflowDependencies,
): Promise<OutcomeWorkflowResult> {
  const occurredAt = input.occurredAt ?? dependencies.clock?.() ?? new Date();

  return runOrchestrationTransaction(dependencies.transactionRunner, async (uow) => {
    const current = await uow.decisions.findById(input.decisionRecordId);
    if (!current) {
      throw new DecisionNotFoundError(input.decisionRecordId);
    }

    assertOutcomeRecordable(current.decision.status, outcomeType, input.attribution);

    const outcome = await uow.outcomes.record({
      decisionRecordId: input.decisionRecordId,
      outcomeType,
      attribution: input.attribution,
      notes: input.notes,
      occurredAt,
    });

    let event: DecisionEventRecord | undefined;
    if (correspondingEventType) {
      event = await uow.decisionEvents.append({
        decisionRecordId: input.decisionRecordId,
        eventType: correspondingEventType,
        occurredAt,
      });
    }

    return { outcome, event };
  });
}

export function recordCustomerReply(
  input: RecordOutcomeWorkflowInput,
  dependencies: OutcomeWorkflowDependencies,
): Promise<OutcomeWorkflowResult> {
  return recordOutcome("CUSTOMER_REPLIED", "CUSTOMER_REPLIED", input, dependencies);
}

export function recordFollowUpSent(
  input: RecordOutcomeWorkflowInput,
  dependencies: OutcomeWorkflowDependencies,
): Promise<OutcomeWorkflowResult> {
  return recordOutcome("FOLLOW_UP_SENT", "FOLLOW_UP_SENT", input, dependencies);
}

export function recordQuotationRequested(
  input: RecordOutcomeWorkflowInput,
  dependencies: OutcomeWorkflowDependencies,
): Promise<OutcomeWorkflowResult> {
  return recordOutcome("QUOTATION_REQUESTED", undefined, input, dependencies);
}

export function recordQuotationSent(
  input: RecordOutcomeWorkflowInput,
  dependencies: OutcomeWorkflowDependencies,
): Promise<OutcomeWorkflowResult> {
  return recordOutcome("QUOTATION_SENT", undefined, input, dependencies);
}

export function recordSaleClosed(
  input: RecordOutcomeWorkflowInput,
  dependencies: OutcomeWorkflowDependencies,
): Promise<OutcomeWorkflowResult> {
  return recordOutcome("SALE_CLOSED", "SALE_CLOSED", input, dependencies);
}

export function recordSaleLost(
  input: RecordOutcomeWorkflowInput,
  dependencies: OutcomeWorkflowDependencies,
): Promise<OutcomeWorkflowResult> {
  return recordOutcome("SALE_LOST", "SALE_LOST", input, dependencies);
}

export function recordConversationAbandoned(
  input: RecordOutcomeWorkflowInput,
  dependencies: OutcomeWorkflowDependencies,
): Promise<OutcomeWorkflowResult> {
  return recordOutcome("ABANDONED", undefined, input, dependencies);
}
