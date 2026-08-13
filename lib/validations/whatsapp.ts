import { z } from "zod";
import { leadSchema } from "./lead";

export const pendingMessageIdSchema = z.string().min(1, { error: "Se requiere un id de mensaje." });
export const conversationIdSchema = z.string().min(1, { error: "Se requiere un id de conversación." });

// Meta's phone_number_id and waba_id are both numeric strings copied
// verbatim from the WhatsApp Manager / Developer dashboard — never
// user-typed free text, so a numeric-only check catches a pasted display
// name or URL fragment early instead of letting it reach the unique index.
const META_ID_REGEX = /^[0-9]+$/;

export const registerWhatsAppPhoneNumberSchema = z.object({
  phoneNumberId: z
    .string()
    .trim()
    .min(1, { error: "El phone_number_id de Meta es obligatorio." })
    .refine((value) => META_ID_REGEX.test(value), { error: "El phone_number_id debe ser numérico — cópialo exactamente desde Meta." }),
  displayPhoneNumber: z.string().trim().min(1, { error: "El número de teléfono a mostrar es obligatorio." }),
  wabaId: z
    .string()
    .trim()
    .min(1, { error: "El id de la cuenta de WhatsApp Business es obligatorio." })
    .refine((value) => META_ID_REGEX.test(value), { error: "El waba_id debe ser numérico — cópialo exactamente desde Meta." }),
  label: z.string().trim().min(1).max(100).optional(),
});

// Mirrors the Prisma ImportDateOrder enum's values
// (server/knowledge/whatsapp-import/timestamp.ts) — the historical import
// flow reuses the same date-order ambiguity resolution as the Knowledge
// WhatsApp importer, just for a different destination.
export const historicalImportDateOrderSchema = z.enum(["DMY", "MDY"]);

// Step 1: parse-only, no persistence — the initial submit and any
// participant-resolution re-submit.
export const previewHistoricalImportSchema = z.object({
  rawText: z.string().trim().min(1, { error: "El texto de la conversación no puede estar vacío." }),
  dateOrder: historicalImportDateOrderSchema.default("DMY"),
  timezone: z.string().trim().min(1, { error: "Se requiere una zona horaria." }),
  manualBusinessSenderLabel: z.string().min(1).optional(),
});

// Step 2: the actual write — same shape plus the OWNER-confirmed customer
// phone (reusing leadSchema's exact phone regex/normalization, so a phone
// typed here always matches the same Lead a manual entry would) and the
// optional post-import analysis opt-in.
export const importHistoricalWhatsAppChatSchema = previewHistoricalImportSchema.extend({
  phone: leadSchema.shape.phone,
  runAnalysis: z.boolean().default(false),
});

export const queueWhatsAppReplySchema = z.object({
  conversationId: conversationIdSchema,
  body: z.string().trim().min(1, { error: "La respuesta no puede estar vacía." }).max(4096),
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
export type PreviewHistoricalImportActionInput = z.infer<typeof previewHistoricalImportSchema>;
export type ImportHistoricalWhatsAppChatActionInput = z.infer<typeof importHistoricalWhatsAppChatSchema>;
export type QueueWhatsAppReplyActionInput = z.infer<typeof queueWhatsAppReplySchema>;
export type ApproveWhatsAppReplyActionInput = z.infer<typeof approveWhatsAppReplySchema>;
export type RejectWhatsAppReplyActionInput = z.infer<typeof rejectWhatsAppReplySchema>;
export type SendQueuedReplyActionInput = z.infer<typeof sendQueuedReplySchema>;
