// Deterministic, direction-aware payment-status extractor. A customer
// confirming payment is a more definitive signal than an advisor merely
// requesting it, so PAYMENT_CONFIRMED candidates carry higher confidence
// than AWAITING_PAYMENT ones — this is what lets a later confirmation
// correctly outrank an earlier request at fold time (server/intelligence/
// lead-commercial-state/fold-candidates.ts), without needing a separate
// "payment already requested" state machine.
//
// normalizeContent is reused from the Observation Engine's keyword
// detectors (a pure text-normalization utility, imported read-only —
// server/intelligence/observation/** is never modified) rather than
// duplicating the same diacritic-stripping logic a third time.

import { normalizeContent } from "../../observation/detectors/keyword-detectors";
import type { FieldCandidate, FieldExtractor, NormalizedMessageForExtraction, PaymentStatus } from "../types";

export const ADVISOR_PAYMENT_REQUEST_KEYWORDS = [
  "numero de cuenta",
  "número de cuenta",
  "realice el pago",
  "realizar el pago",
  "para el pago",
  "para que pague",
  "cuenta bancaria",
  "le paso el numero",
  "le paso los datos",
  "yape al",
  "plin al",
] as const;

export const CUSTOMER_PAYMENT_CONFIRM_KEYWORDS = [
  "ya pague",
  "ya pagué",
  "ya realice el pago",
  "ya realicé el pago",
  "listo el pago",
  "ya transferi",
  "ya transferí",
  "ya deposite",
  "ya deposité",
  "pago realizado",
  "esta pagado",
  "está pagado",
  "ya yapee",
  "ya yapeé",
] as const;

const PAYMENT_EXTRACTOR_VERSION = "1.0.0";

function matchesAny(normalized: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => normalized.includes(keyword));
}

function toCandidate(
  value: PaymentStatus,
  confidence: number,
  message: NormalizedMessageForExtraction,
): FieldCandidate<PaymentStatus> {
  return {
    value,
    confidence,
    conversationId: message.conversationId,
    occurredAt: message.occurredAt,
    evidence: [{ sourceType: "conversation_message", sourceId: message.id, excerpt: message.content }],
  };
}

export const paymentStatusExtractor: FieldExtractor<PaymentStatus> = {
  id: "deterministic.payment_status",
  version: PAYMENT_EXTRACTOR_VERSION,
  extract(messages: NormalizedMessageForExtraction[]): FieldCandidate<PaymentStatus>[] {
    const candidates: FieldCandidate<PaymentStatus>[] = [];

    for (const message of messages) {
      const normalized = normalizeContent(message.content);

      if (message.direction === "INBOUND" && matchesAny(normalized, CUSTOMER_PAYMENT_CONFIRM_KEYWORDS)) {
        candidates.push(toCandidate("PAYMENT_CONFIRMED", 0.9, message));
      } else if (message.direction === "OUTBOUND" && matchesAny(normalized, ADVISOR_PAYMENT_REQUEST_KEYWORDS)) {
        candidates.push(toCandidate("AWAITING_PAYMENT", 0.85, message));
      }
    }

    return candidates;
  },
};
