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
  CUSTOMER_QUESTION: "Hizo una pregunta",
  PRICE_REQUEST: "Consulta de precio",
  PRODUCT_AVAILABILITY: "Consulta de disponibilidad",
  COMPATIBILITY_QUESTION: "Consulta de compatibilidad",
  INSTALLATION_QUESTION: "Consulta de instalación",
  DELIVERY_REQUEST: "Consulta de envío",
  PAYMENT_REQUEST: "Consulta sobre cómo pagar",
  CATALOG_REQUEST: "Pidió el catálogo",
  CUSTOMER_OBJECTION: "Puso una objeción",
  BUYING_SIGNAL: "Listo para comprar",
  DISCOUNT_REQUEST: "Pidió un descuento",
  ADVISOR_COMMITMENT_PENDING: "Compromiso pendiente del asesor",
  FOLLOW_UP_DUE: "Seguimiento pendiente",
  PAYMENT_CONFIRMATION_PENDING: "Pago solicitado, aún sin confirmar",
  DELIVERY_CONFIRMATION_PENDING: "Detalles de entrega pendientes",
  QUOTATION_PROMISED: "Cotización prometida, aún sin enviar",
  WAITING_FOR_CUSTOMER_DECISION: "Esperando la decisión del cliente",
  CUSTOMER_SELF_DEFERRED: "El cliente dijo que respondería después",
  CUSTOMER_CLOSING_ACKNOWLEDGEMENT: "Conversación cerrada naturalmente",
  CONVERSATION_NOT_COMMERCIAL: "No es una conversación comercial",
  CUSTOMER_DECLINED: "El cliente declinó",
  UNCERTAIN_CONTEXT: "No hay suficiente contexto para saber",
  AMBIGUOUS_INTENT: "El significado es ambiguo",
};
