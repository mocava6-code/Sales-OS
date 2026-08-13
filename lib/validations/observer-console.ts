import { z } from "zod";

export const conversationIdSchema = z.string().min(1, { error: "Se requiere un id de conversación." });

export const observationTypeSchema = z.enum([
  "PRICE_REQUEST",
  "COMPATIBILITY_QUESTION",
  "INSTALLATION_QUESTION",
  "CUSTOMER_GHOSTED",
  "PHOTO_REQUEST",
  "DISCOUNT_NEGOTIATION",
]);

export const observationStateSchema = z.enum(["ANY", "HAS_ANY", "HAS_NONE"]);

export const getConversationTimelineSchema = z.object({
  conversationId: conversationIdSchema,
});

/**
 * HAS_NONE ("conversations with zero observations") combined with
 * hasObservationType ("...that have this specific observation type") is a
 * contradiction — rejected here, at the application validation boundary,
 * per the Observer Console v1.1 spec. The repository/read-model layers
 * below trust this has already been checked.
 */
export const searchConversationsSchema = z
  .object({
    searchText: z.string().trim().min(1).max(200).optional(),
    occurredAfter: z.coerce.date().optional(),
    occurredBefore: z.coerce.date().optional(),
    hasObservationType: observationTypeSchema.optional(),
    observationState: observationStateSchema.optional(),
    limit: z.number().int().positive().optional(),
  })
  .refine(
    (data) => !(data.observationState === "HAS_NONE" && data.hasObservationType),
    "HAS_NONE no se puede combinar con un tipo de observación específico.",
  );

export type GetConversationTimelineActionInput = z.infer<typeof getConversationTimelineSchema>;
export type SearchConversationsActionInput = z.infer<typeof searchConversationsSchema>;
