// Bounded reason-code taxonomy for Semantic Response Intelligence v0.
//
// Refined from real (anonymized) Koriaki production conversations audited
// during Legacy Data Remediation v0 — not blindly copied from the
// suggested starter list. Two codes exist specifically because real
// evidence demanded them:
//   - CONVERSATION_NOT_COMMERCIAL: a real production conversation
//     (+51933517901's reparented thread) contained a genuine sales
//     exchange followed, days later, by entirely unrelated personal
//     messages ("Que te llevo", "Ya pues maria", stickers) in the SAME
//     thread. "No action needed because it's a polite closing" and "no
//     action needed because this isn't even a sales conversation" are
//     different claims a reviewer needs to tell apart.
//   - CUSTOMER_DECLINED is intentionally listed but the deterministic
//     classifier never auto-resolves to it — an explicit "no quiero" may
//     still warrant a save-the-sale reply, so that judgment is left to
//     the AI layer or UNCERTAIN, never assumed closed. See
//     deterministic-classifier.ts's own doc comment.
//
// Intentionally a plain string union + Zod enum, not a native Postgres
// enum (server/db/schema.prisma's ConversationActionState.reasonCode) —
// this taxonomy is expected to keep evolving from evidence; adding a code
// here needs no migration. actionState/source (the stable contract
// Today/Kori depend on) ARE native enums; this one deliberately isn't.

import { z } from "zod";

export const ACTION_REASON_CODES = [
  // REPLY_REQUIRED
  "CUSTOMER_QUESTION",
  "PRICE_REQUEST",
  "PRODUCT_AVAILABILITY",
  "COMPATIBILITY_QUESTION",
  "INSTALLATION_QUESTION",
  "DELIVERY_REQUEST",
  "PAYMENT_REQUEST",
  "CATALOG_REQUEST",
  "CUSTOMER_OBJECTION",
  "BUYING_SIGNAL",
  "DISCOUNT_REQUEST",

  // FOLLOW_UP_REQUIRED
  "ADVISOR_COMMITMENT_PENDING",
  "FOLLOW_UP_DUE",
  "PAYMENT_CONFIRMATION_PENDING",
  "DELIVERY_CONFIRMATION_PENDING",
  "QUOTATION_PROMISED",

  // WAITING_ON_CUSTOMER
  "WAITING_FOR_CUSTOMER_DECISION",
  "CUSTOMER_SELF_DEFERRED",

  // NO_ACTION_REQUIRED
  "CUSTOMER_CLOSING_ACKNOWLEDGEMENT",
  "CONVERSATION_NOT_COMMERCIAL",
  "CUSTOMER_DECLINED",

  // UNCERTAIN
  "UNCERTAIN_CONTEXT",
  "AMBIGUOUS_INTENT",
] as const;

export type ActionReasonCode = (typeof ACTION_REASON_CODES)[number];

export const actionReasonCodeSchema = z.enum(ACTION_REASON_CODES);

/**
 * Short, advisor-facing labels for Today (Phase 8) and anywhere else a
 * human needs to see WHY a conversation landed where it did — kept next to
 * the taxonomy itself so a new reason code and its label can never drift
 * out of sync (TypeScript's Record<ActionReasonCode, string> below fails to
 * compile if one is ever missing).
 */
export const ACTION_REASON_CODE_LABELS: Record<ActionReasonCode, string> = {
  CUSTOMER_QUESTION: "Asked a question",
  PRICE_REQUEST: "Asked about price",
  PRODUCT_AVAILABILITY: "Asked about availability",
  COMPATIBILITY_QUESTION: "Asked about compatibility",
  INSTALLATION_QUESTION: "Asked about installation",
  DELIVERY_REQUEST: "Asked about delivery",
  PAYMENT_REQUEST: "Asked how to pay",
  CATALOG_REQUEST: "Asked for the catalog",
  CUSTOMER_OBJECTION: "Raised an objection",
  BUYING_SIGNAL: "Ready to buy",
  DISCOUNT_REQUEST: "Asked for a discount",
  ADVISOR_COMMITMENT_PENDING: "You promised something, not yet sent",
  FOLLOW_UP_DUE: "Follow-up is overdue",
  PAYMENT_CONFIRMATION_PENDING: "Payment requested, not yet confirmed",
  DELIVERY_CONFIRMATION_PENDING: "Delivery details pending",
  QUOTATION_PROMISED: "Quotation promised, not yet sent",
  WAITING_FOR_CUSTOMER_DECISION: "Waiting on the customer's decision",
  CUSTOMER_SELF_DEFERRED: "Customer said they'll follow up",
  CUSTOMER_CLOSING_ACKNOWLEDGEMENT: "Closed politely, nothing pending",
  CONVERSATION_NOT_COMMERCIAL: "Not a sales conversation",
  CUSTOMER_DECLINED: "Customer declined",
  UNCERTAIN_CONTEXT: "Not enough context to tell",
  AMBIGUOUS_INTENT: "Meaning is ambiguous",
};
