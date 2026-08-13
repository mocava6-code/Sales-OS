import { z } from "zod";

export const analyzeConversationImportSchema = z.object({
  rawText: z.string().trim().min(1, { error: "El texto de la conversación no puede estar vacío." }),
  externalSource: z.enum(["WHATSAPP_TXT_EXPORT", "WHATSAPP_ZIP_EXPORT", "PASTED_TEXT"]),
  sourceConversationId: z.string().min(1),
  rawFileHash: z.string().min(1).optional(),
  /** The OWNER's answer to a previously-required "which participant is Koriaki?" prompt. */
  manualBusinessSenderLabel: z.string().min(1).optional(),
});

export type AnalyzeConversationImportActionInput = z.infer<typeof analyzeConversationImportSchema>;

export const startWebsiteSyncSchema = z.object({
  rootUrl: z.url({ error: "Ingresa una URL válida." }),
});

export type StartWebsiteSyncActionInput = z.infer<typeof startWebsiteSyncSchema>;

export const processSyncBatchSchema = z.object({
  sourceId: z.string().min(1),
});

export type ProcessSyncBatchActionInput = z.infer<typeof processSyncBatchSchema>;

export const promoteCandidateSchema = z.object({
  candidateId: z.string().min(1),
});

export type PromoteCandidateActionInput = z.infer<typeof promoteCandidateSchema>;

export const rejectCandidateSchema = z.object({
  candidateId: z.string().min(1),
  rejectionReason: z.string().max(500).optional(),
});

export type RejectCandidateActionInput = z.infer<typeof rejectCandidateSchema>;
