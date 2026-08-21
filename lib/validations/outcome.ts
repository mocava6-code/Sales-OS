import { z } from "zod";

// Kori Sales Memory v1 — the lightweight "mark what happened" path, decoupled
// from lib/validations/decision.ts's decisionRecordId-based outcome schemas
// (which stay exactly as they are, for the Decision Engine's own attribution
// workflow). This one is for the button on the lead detail page: a
// conversation, an outcome, and (depending on the outcome) one bounded
// follow-up question — never a form.

export const conversationOutcomeTypeSchema = z.enum(["SALE_CLOSED", "SALE_LOST", "NOT_AN_OPPORTUNITY"]);
export type ConversationOutcomeType = z.infer<typeof conversationOutcomeTypeSchema>;

// A bounded, evolving taxonomy — plain string union + Zod enum, not a native
// Postgres enum, same philosophy as ActionReasonCode (server/intelligence/
// response-action/reason-codes.ts): a new reason should never need a
// migration.
export const LOST_REASONS = ["PRECIO", "TIEMPO_DE_ESPERA", "ENCONTRO_OTRA_OPCION", "DEJO_DE_RESPONDER", "OTRO"] as const;
export const lostReasonSchema = z.enum(LOST_REASONS);
export type LostReason = z.infer<typeof lostReasonSchema>;

export const LOST_REASON_LABELS: Record<LostReason, string> = {
  PRECIO: "Precio",
  TIEMPO_DE_ESPERA: "Tiempo de espera",
  ENCONTRO_OTRA_OPCION: "Encontró otra opción",
  DEJO_DE_RESPONDER: "Dejó de responder",
  OTRO: "Otro",
};

// Kori Sales Memory ROI attribution — deliberately only the two attributions
// a human can actually assert firsthand ("this outcome followed Kori's open
// recommendation" vs "it didn't"). UNATTRIBUTED is never sent from the
// client; it's the service's own default when no decision is linked at all.
export const conversationOutcomeAttributionSchema = z.enum(["KORI_RECOMMENDATION", "ADVISOR_ALTERNATIVE"]);
export type ConversationOutcomeAttribution = z.infer<typeof conversationOutcomeAttributionSchema>;

export const recordConversationOutcomeSchema = z
  .object({
    conversationId: z.string().min(1, { error: "Se requiere un id de conversación." }),
    outcomeType: conversationOutcomeTypeSchema,
    lostReason: lostReasonSchema.optional(),
    productSold: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(2000).optional(),
    // Present only when the lead page found an open DecisionRecord for this
    // conversation and the advisor chose to link this outcome to it.
    decisionRecordId: z.string().min(1).optional(),
    attribution: conversationOutcomeAttributionSchema.optional(),
  })
  .refine((data) => data.outcomeType !== "SALE_LOST" || data.lostReason !== undefined, {
    error: "Selecciona por qué se perdió la venta.",
    path: ["lostReason"],
  })
  .refine((data) => !data.decisionRecordId || data.attribution !== undefined, {
    error: "Indica si este resultado fue por la recomendación de Kori.",
    path: ["attribution"],
  });

export type RecordConversationOutcomeInput = z.infer<typeof recordConversationOutcomeSchema>;

// Kori Sales Memory v1's Fase C — the "Kori sugiere" hint request. Only a
// conversationId: same tenant-authorized-conversation boundary as recording
// an outcome, never a second way to scope this.
export const suggestConversationOutcomeSchema = z.object({
  conversationId: z.string().min(1, { error: "Se requiere un id de conversación." }),
});
export type SuggestConversationOutcomeInput = z.infer<typeof suggestConversationOutcomeSchema>;
