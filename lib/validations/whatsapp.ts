import { z } from "zod";

export const pendingMessageIdSchema = z.string().min(1, { error: "A message id is required." });
export const conversationIdSchema = z.string().min(1, { error: "A conversation id is required." });

// Meta's phone_number_id and waba_id are both numeric strings copied
// verbatim from the WhatsApp Manager / Developer dashboard — never
// user-typed free text, so a numeric-only check catches a pasted display
// name or URL fragment early instead of letting it reach the unique index.
const META_ID_REGEX = /^[0-9]+$/;

export const registerWhatsAppPhoneNumberSchema = z.object({
  phoneNumberId: z
    .string()
    .trim()
    .min(1, { error: "The Meta phone_number_id is required." })
    .refine((value) => META_ID_REGEX.test(value), { error: "phone_number_id must be numeric — copy it exactly from Meta." }),
  displayPhoneNumber: z.string().trim().min(1, { error: "The display phone number is required." }),
  wabaId: z
    .string()
    .trim()
    .min(1, { error: "The WhatsApp Business Account id is required." })
    .refine((value) => META_ID_REGEX.test(value), { error: "waba_id must be numeric — copy it exactly from Meta." }),
  label: z.string().trim().min(1).max(100).optional(),
});

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

export type RegisterWhatsAppPhoneNumberInput = z.infer<typeof registerWhatsAppPhoneNumberSchema>;
export type QueueWhatsAppReplyActionInput = z.infer<typeof queueWhatsAppReplySchema>;
export type ApproveWhatsAppReplyActionInput = z.infer<typeof approveWhatsAppReplySchema>;
export type RejectWhatsAppReplyActionInput = z.infer<typeof rejectWhatsAppReplySchema>;
export type SendQueuedReplyActionInput = z.infer<typeof sendQueuedReplySchema>;
