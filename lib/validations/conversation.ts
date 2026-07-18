import { z } from "zod";

export const conversationEntrySchema = z.object({
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  content: z.string().trim().min(1, { error: "Message content can't be empty." }),
});

export const conversationSchema = z.object({
  leadId: z.string().min(1),
  entries: z.array(conversationEntrySchema).min(1, { error: "Add at least one message." }),
});

export type ConversationInput = z.infer<typeof conversationSchema>;
