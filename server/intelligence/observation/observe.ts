// Kori's Observation Engine — the one public function. Mirrors the shape of
// every other engine call in this codebase (analyzeConversation(input, deps),
// makeDecisions(context, deps)), except there is no `deps` argument: the
// engine is fully deterministic and has no AIProvider or other dependency to
// inject. Pure, synchronous, no I/O — never throws.

import type { DomainEvent, MessageReceivedEvent } from "../../domain-events/types";
import { KEYWORD_DETECTORS } from "./detectors/keyword-detectors";
import { detectCustomerGhosted } from "./detectors/ghosting-detector";
import type { Observation } from "./types";

function isMessageReceivedEvent(event: DomainEvent): event is MessageReceivedEvent {
  return event.type === "MESSAGE_RECEIVED";
}

/** Runs every applicable detector for the event's type. Returns zero, one, or several Observations — never mutually exclusive. */
export function deriveObservations(event: DomainEvent): Observation[] {
  const observations: Observation[] = [];

  if (isMessageReceivedEvent(event)) {
    for (const detect of KEYWORD_DETECTORS) {
      const observation = detect(event);
      if (observation) observations.push(observation);
    }
  }

  const ghosted = detectCustomerGhosted(event);
  if (ghosted) observations.push(ghosted);

  return observations;
}
