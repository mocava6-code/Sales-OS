// Serialization-safe DTO for Lead Commercial State — same discipline as
// server/application/dto.ts's other DTOs and server/observer-console/types.ts:
// ISO date strings, nothing Prisma-shaped, built server-side from the
// authoritative engine result.

import type { ConversationCommercialState, NextActionType, PaymentStatus } from "../intelligence/lead-commercial-state/types";

/**
 * One display-ready field: value + confidence + (when present) the
 * evidence excerpt or reasoning that grounds it — "confidence/evidence
 * affordance where useful" (Sprint 7 revision #2). null value means "no
 * signal found," not "confirmed absent."
 */
export interface FieldDisplayDTO<T> {
  value: T | null;
  confidence: number;
  evidenceExcerpt: string | null;
  reasoning: string | null;
}

export interface LeadCommercialStateDTO {
  productInterest: FieldDisplayDTO<string>;
  vehicleModel: FieldDisplayDTO<string>;
  /** Kori Data Correctness Phase 1C. */
  vehicleBrand: FieldDisplayDTO<string>;
  /** Kori Data Correctness Phase 1C. */
  vehicleYear: FieldDisplayDTO<number>;
  deliveryLocation: FieldDisplayDTO<string>;
  /** ISO string when present. */
  requestedDeliveryAt: FieldDisplayDTO<string>;
  paymentStatus: FieldDisplayDTO<PaymentStatus>;
  lastContactAt: string;
  lastContactDirection: "INBOUND" | "OUTBOUND";
  conversationState: ConversationCommercialState;
  nextAction: FieldDisplayDTO<NextActionType>;
  /** ISO string. */
  followUpDueAt: FieldDisplayDTO<string>;
  activeConversationId: string;
  derivedAt: string;
}
