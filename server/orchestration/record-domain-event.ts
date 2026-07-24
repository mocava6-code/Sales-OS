// Observer Mode v1 — the primary workflow. Same shape as
// analyzeConversationAndCreateDecisions (engine call, then one atomic
// persistence transaction), but with no AI call: the Observation Engine
// (server/intelligence/observation/) is fully deterministic, so there's
// nothing to await before opening the transaction.

import type { DomainEvent } from "../domain-events/types";
import { deriveObservations } from "../intelligence/observation/observe";
import type { SavedDomainEventRecord, SavedObservationRecord } from "../persistence/types";
import type { TransactionRunner } from "../persistence/unit-of-work";
import { runOrchestrationTransaction } from "./transaction";

export interface RecordDomainEventInput {
  event: DomainEvent;
  conversationEntryId?: string;
}

export interface RecordDomainEventDependencies {
  transactionRunner: TransactionRunner;
}

export interface RecordDomainEventResult {
  domainEvent: SavedDomainEventRecord;
  observations: SavedObservationRecord[];
}

export async function recordDomainEvent(
  input: RecordDomainEventInput,
  dependencies: RecordDomainEventDependencies,
): Promise<RecordDomainEventResult> {
  const { event } = input;

  // Deterministic, no I/O — never awaited inside the transaction below,
  // same "AI/derivation calls happen before the transaction opens" rule as
  // analyzeConversationAndCreateDecisions.
  const observations = deriveObservations(event);

  return runOrchestrationTransaction(dependencies.transactionRunner, async (uow) => {
    const savedEvent = await uow.domainEvents.append({
      businessId: event.businessId,
      conversationId: event.conversationId,
      conversationEntryId: input.conversationEntryId,
      event,
    });

    const savedObservations: SavedObservationRecord[] = [];
    for (const observation of observations) {
      savedObservations.push(
        await uow.observations.save({
          businessId: event.businessId,
          conversationId: event.conversationId,
          domainEventId: savedEvent.id,
          conversationEntryId: input.conversationEntryId,
          observation,
          occurredAt: event.occurredAt,
        }),
      );
    }

    return { domainEvent: savedEvent, observations: savedObservations };
  });
}
