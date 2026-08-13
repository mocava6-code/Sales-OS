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
