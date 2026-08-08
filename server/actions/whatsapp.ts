"use server";

// Thin Next.js server action wrappers. All the actual logic lives in
// server/application/whatsapp-actions.ts — see server/actions/decisions.ts
// for the same pattern. No Meta SDK is ever imported here or reachable from
// the client.

import {
  approveWhatsAppReplyHandler,
  importHistoricalWhatsAppChatHandler,
  previewHistoricalImportHandler,
  queueWhatsAppReplyHandler,
  registerWhatsAppPhoneNumberHandler,
  rejectWhatsAppReplyHandler,
  sendQueuedReplyHandler,
} from "@/server/application/whatsapp-actions";
import { extractRawTextFromUpload } from "@/server/knowledge/whatsapp-import/upload-adapter";

export async function registerWhatsAppPhoneNumberAction(rawInput: unknown) {
  return registerWhatsAppPhoneNumberHandler(rawInput);
}

export async function previewHistoricalImportFromTextAction(rawInput: unknown) {
  return previewHistoricalImportHandler(rawInput);
}

// FormData-specific glue — same reasoning as server/actions/knowledge.ts's
// analyzeUploadedConversationAction: extracting text from an uploaded File
// is a Next.js transport concern, not reusable business logic, so it lives
// here rather than in the application handler.
export async function previewHistoricalImportFromUploadAction(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false as const, error: { code: "INVALID_INPUT" as const, message: "No file was uploaded." } };
  }

  try {
    const extracted = await extractRawTextFromUpload(file);
    return previewHistoricalImportHandler({
      rawText: extracted.rawText,
      dateOrder: formData.get("dateOrder") || undefined,
      timezone: formData.get("timezone") || undefined,
      manualBusinessSenderLabel: formData.get("manualBusinessSenderLabel") || undefined,
    });
  } catch (error) {
    return {
      ok: false as const,
      error: { code: "INVALID_INPUT" as const, message: error instanceof Error ? error.message : "Could not read the uploaded file." },
    };
  }
}

export async function importHistoricalWhatsAppChatAction(rawInput: unknown) {
  return importHistoricalWhatsAppChatHandler(rawInput);
}

export async function queueWhatsAppReplyAction(rawInput: unknown) {
  return queueWhatsAppReplyHandler(rawInput);
}

export async function approveWhatsAppReplyAction(rawInput: unknown) {
  return approveWhatsAppReplyHandler(rawInput);
}

export async function rejectWhatsAppReplyAction(rawInput: unknown) {
  return rejectWhatsAppReplyHandler(rawInput);
}

export async function sendQueuedReplyAction(rawInput: unknown) {
  return sendQueuedReplyHandler(rawInput);
}
