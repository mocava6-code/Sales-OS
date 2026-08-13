// Canonical Spanish UI labels for internal enum/string values.
//
// Sales OS is Spanish-first: internal identifiers (Prisma enums, TS union
// types, reason codes) stay in English because renaming them is a schema/
// migration risk for no user-facing benefit — but every value a user can
// see must resolve through exactly ONE label map here, never be
// independently translated per-component. If you're about to write
// `"NEEDS_REPLY" ? "Requiere respuesta" : ...` inline in a component,
// that mapping belongs in this file instead.
//
// "Sin información" (never "Desconocido") is the standard rendering for
// missing/unknown data across the product — see UNKNOWN_LABEL below.

import type { ConversationStatus, LeadPriority, LeadStatus, UserRole } from "@/server/db/generated/client";
import type { ConversationCommercialState, NextActionType, PaymentStatus } from "@/server/intelligence/lead-commercial-state/types";

/** Standard rendering for "we don't have this information" — never "Desconocido". */
export const UNKNOWN_LABEL = "Sin información";

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "Nuevo",
  CONTACTED: "Contactado",
  FOLLOW_UP: "En seguimiento",
  WON: "Venta cerrada",
  LOST: "Venta perdida",
};

export const LEAD_PRIORITY_LABELS: Record<LeadPriority, string> = {
  NORMAL: "Normal",
  HIGH: "Alta",
};

/** Conversation.status — also used for the commercial-state DTO's ConversationCommercialState, which mirrors it exactly. */
export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus | ConversationCommercialState, string> = {
  NEEDS_REPLY: "Requiere respuesta",
  WAITING_ON_CUSTOMER: "Esperando al cliente",
  CLOSED: "Cerrada",
};

export const CUSTOMER_TYPE_LABELS: Record<"RETAIL" | "WHOLESALE" | "UNKNOWN", string> = {
  RETAIL: "Cliente final",
  WHOLESALE: "Mayorista",
  UNKNOWN: UNKNOWN_LABEL,
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  NOT_REQUESTED: "No solicitado",
  AWAITING_PAYMENT: "Esperando pago",
  PAYMENT_CONFIRMED: "Pago confirmado",
};

export const NEXT_ACTION_LABELS: Record<NextActionType, string> = {
  ANSWER_QUESTION: "Responder consulta",
  CONFIRM_PAYMENT: "Confirmar pago",
  SCHEDULE_DELIVERY: "Coordinar entrega",
  SEND_QUOTE: "Enviar cotización",
  FOLLOW_UP: "Hacer seguimiento",
  NONE: "Sin acción pendiente",
};

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  OWNER: "Propietario",
  SALESPERSON: "Asesor",
};

export const KNOWLEDGE_CATEGORY_LABELS: Record<string, string> = {
  PRODUCT: "Producto",
  COMPATIBILITY: "Compatibilidad",
  OBJECTION: "Objeción",
  COMMERCIAL_POLICY: "Política comercial",
  PROMOTION: "Promoción",
  FAQ: "Preguntas frecuentes",
  RECOMMENDED_RESPONSE: "Respuesta recomendada",
  LOGISTICS: "Logística",
  PRICING: "Precios",
};

export const BEHAVIOR_CATEGORY_LABELS: Record<string, string> = {
  PROCESS_PATTERN: "Patrón de proceso",
  SALES_BEHAVIOR: "Comportamiento de venta",
  CUSTOMER_PATTERN: "Patrón del cliente",
};

export const KNOWLEDGE_SOURCE_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  PROCESSING: "Procesando…",
  COMPLETED: "Completado",
  PARTIAL: "Parcial",
  FAILED: "Fallido",
};

export const DECISION_STATUS_LABELS: Record<string, string> = {
  PROPOSED: "Propuesta",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
  EXECUTED: "Ejecutada",
  CANCELLED: "Cancelada",
  OVERRIDDEN: "Reemplazada por el asesor",
};

export const DECISION_RISK_LABELS: Record<string, string> = {
  LOW: "Riesgo bajo",
  MEDIUM: "Riesgo medio",
  HIGH: "Riesgo alto",
  CRITICAL: "Riesgo crítico",
};

export const DECISION_IMPACT_LABELS: Record<string, string> = {
  LOW: "Impacto bajo",
  MEDIUM: "Impacto medio",
  HIGH: "Impacto alto",
};

export const DECISION_APPROVAL_LABELS: Record<string, string> = {
  AUTO_ALLOWED: "Permitido automáticamente",
  ADVISOR_APPROVAL_REQUIRED: "Necesita aprobación del asesor",
  ADMIN_APPROVAL_REQUIRED: "Necesita aprobación del administrador",
  HUMAN_INFORMATION_REQUIRED: "Falta información",
};

export const DECISION_ACTION_LABELS: Record<string, string> = {
  approve: "Aprobar",
  reject: "Rechazar",
  override: "Registrar cambio",
  execute: "Marcar como ejecutada",
};

export const OVERRIDE_ACTION_TYPE_LABELS: Record<string, string> = {
  IGNORED_RECOMMENDATION: "Ignoró la recomendación",
  PARTIALLY_FOLLOWED_RECOMMENDATION: "La siguió parcialmente",
  CUSTOM_ACTION: "Hizo algo distinto",
};

/** No outcome-recording UI exists yet (see server/orchestration — recordOutcomeAction has no frontend caller) — ready for when one is built, so QUOTATION_SENT/SALE_CLOSED/SALE_LOST never render raw on day one. */
export const OUTCOME_TYPE_LABELS: Record<string, string> = {
  CUSTOMER_REPLIED: "Cliente respondió",
  MEETING_SCHEDULED: "Reunión agendada",
  FOLLOW_UP_SENT: "Seguimiento enviado",
  QUOTATION_REQUESTED: "Cotización solicitada",
  QUOTATION_SENT: "Cotización enviada",
  SALE_CLOSED: "Venta cerrada",
  SALE_LOST: "Venta perdida",
  ABANDONED: "Abandonado",
};

export const OBSERVER_EVENT_TYPE_LABELS: Record<string, string> = {
  CONVERSATION_CREATED: "Conversación creada",
  MESSAGE_RECEIVED: "Mensaje recibido",
  MESSAGE_SENT: "Mensaje enviado",
  ATTACHMENT_RECEIVED: "Adjunto recibido",
  CONVERSATION_CLOSED: "Conversación cerrada",
};
