import { z } from "zod";

export const conversationEntrySchema = z.object({
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  content: z.string().trim().min(1, { error: "El mensaje no puede estar vacío." }),
});

export const conversationSchema = z.object({
  leadId: z.string().min(1),
  entries: z.array(conversationEntrySchema).min(1, { error: "Agrega al menos un mensaje." }),
});

export type ConversationInput = z.infer<typeof conversationSchema>;
