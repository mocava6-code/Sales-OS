// followUpDueAt is not an observed fact — it's a policy computation (which
// SLA applies to the resolved nextAction, added to the active
// conversation's last contact time). Modeled as Inference<Date>, with
// reasoning that names both the SLA and the base timestamp it was applied
// to, so the number is always traceable rather than a bare date.

import type { Inference } from "../types";
import type { NextActionType } from "./types";

export const DEFAULT_SLA_HOURS_BY_NEXT_ACTION: Record<NextActionType, number> = {
  CONFIRM_PAYMENT: 4,
  ANSWER_QUESTION: 2,
  SCHEDULE_DELIVERY: 24,
  SEND_QUOTE: 24,
  FOLLOW_UP: 24,
  NONE: 48,
};

export function resolveFollowUpDueAt(
  lastContactAt: Date,
  nextAction: NextActionType,
  activeConversationId: string,
  slaHoursByNextAction: Partial<Record<NextActionType, number>>,
): Inference<Date> {
  const slaHours = slaHoursByNextAction[nextAction] ?? DEFAULT_SLA_HOURS_BY_NEXT_ACTION[nextAction];
  const dueAt = new Date(lastContactAt.getTime() + slaHours * 60 * 60 * 1000);

  return {
    kind: "inference",
    value: dueAt,
    confidence: 1,
    evidence: [{ sourceType: "conversation_message", sourceId: activeConversationId }],
    reasoning: `SLA de ${slaHours}h para ${nextAction}, aplicado al último contacto del ${lastContactAt.toISOString()}.`,
  };
}
