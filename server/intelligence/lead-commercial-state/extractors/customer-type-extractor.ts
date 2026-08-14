// Deterministic, direction-aware customer-type extractor. Koriaki's
// advisors routinely ask a direct qualifying question early in a
// conversation ("¿es cliente final o distribuidor?") — the customer's own
// direct answer is a grounded, high-confidence signal, same discipline as
// payment-extractor.ts's CUSTOMER_PAYMENT_CONFIRM_KEYWORDS. The advisor's
// question itself is never a candidate (it carries no value, only intent to
// ask), and a message containing a negation near either keyword is skipped
// entirely rather than guessed — "no soy distribuidor" must never resolve
// to WHOLESALE. An honest "no signal" beats a confidently wrong one.
//
// This was previously the ONLY customerType source's entire domain (see
// server/db/schema.prisma's CustomerTypeProfile enum comment: "Tier 2
// (InferenceSet.customerType) is the only source") — this extractor adds a
// tier-3 deterministic fallback so the field isn't 100% dependent on the AI
// pipeline (server/intelligence/pipeline.ts) having succeeded at least once.
//
// normalizeContent reused from the Observation Engine's keyword detectors,
// same as payment-extractor.ts.

import { normalizeContent } from "../../observation/detectors/keyword-detectors";
import type { CustomerType } from "../../types";
import type { FieldCandidate, FieldExtractor, NormalizedMessageForExtraction } from "../types";

export const RETAIL_KEYWORDS = ["cliente final", "consumidor final", "soy cliente final", "para uso personal"] as const;

export const WHOLESALE_KEYWORDS = ["distribuidor", "revendedor", "para reventa", "mayorista"] as const;

// Checked against the whole message, not proximity to the matched
// keyword — simple and conservative on purpose: withholding a real
// signal is always safer than a wrong one.
const NEGATION_WORDS = ["no soy", "no es", "no somos", "ya no soy", "nunca he sido"] as const;

const CUSTOMER_TYPE_EXTRACTOR_VERSION = "1.0.0";
// Matches payment-extractor.ts's CUSTOMER_PAYMENT_CONFIRM_KEYWORDS level —
// a direct, explicit self-identification, not an inferred behavior pattern.
const CUSTOMER_TYPE_CONFIDENCE = 0.9;

function matchesAny(normalized: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => normalized.includes(keyword));
}

function toCandidate(value: CustomerType, message: NormalizedMessageForExtraction): FieldCandidate<CustomerType> {
  return {
    value,
    confidence: CUSTOMER_TYPE_CONFIDENCE,
    conversationId: message.conversationId,
    occurredAt: message.occurredAt,
    evidence: [{ sourceType: "conversation_message", sourceId: message.id, excerpt: message.content }],
  };
}

export const customerTypeExtractor: FieldExtractor<CustomerType> = {
  id: "deterministic.customer_type",
  version: CUSTOMER_TYPE_EXTRACTOR_VERSION,
  extract(messages: NormalizedMessageForExtraction[]): FieldCandidate<CustomerType>[] {
    const candidates: FieldCandidate<CustomerType>[] = [];

    for (const message of messages) {
      if (message.direction !== "INBOUND") continue;
      const normalized = normalizeContent(message.content);
      if (matchesAny(normalized, NEGATION_WORDS)) continue;

      if (matchesAny(normalized, WHOLESALE_KEYWORDS)) {
        candidates.push(toCandidate("WHOLESALE", message));
      } else if (matchesAny(normalized, RETAIL_KEYWORDS)) {
        candidates.push(toCandidate("RETAIL", message));
      }
    }

    return candidates;
  },
};
