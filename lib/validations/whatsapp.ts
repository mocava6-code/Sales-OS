import { z } from "zod";

export const pendingMessageIdSchema = z.string().min(1, { error: "A message id is required." });
export const conversationIdSchema = z.string().min(1, { error: "A conversation id is required." });

export const queueWhatsAppReplySchema = z.object({
  conversationId: conversationIdSchema,
  body: z.string().trim().min(1, { error: "The reply can't be empty." }).max(4096),
  decisionRecordId: z.string().min(1).optional(),
});

export const approveWhatsAppReplySchema = z.object({
  pendingMessageId: pendingMessageIdSchema,
});

export const rejectWhatsAppReplySchema = z.object({
  pendingMessageId: pendingMessageIdSchema,
});

export const sendQueuedReplySchema = z.object({
  pendingMessageId: pendingMessageIdSchema,
});

export type QueueWhatsAppReplyActionInput = z.infer<typeof queueWhatsAppReplySchema>;
export type ApproveWhatsAppReplyActionInput = z.infer<typeof approveWhatsAppReplySchema>;
export type RejectWhatsAppReplyActionInput = z.infer<typeof rejectWhatsAppReplySchema>;
export type SendQueuedReplyActionInput = z.infer<typeof sendQueuedReplySchema>;
