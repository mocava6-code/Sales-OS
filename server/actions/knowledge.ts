"use server";

// Thin Next.js server action wrappers. All the actual logic lives in
// server/application/knowledge-actions.ts — see server/actions/whatsapp.ts
// for the same pattern. The one exception is analyzeUploadedConversationAction
// below: extracting text from an uploaded File is inherently a Next.js
// FormData concern, not reusable business logic, so that (and only that)
// glue lives here rather than in the application layer — the actual
// extraction logic it calls (extractRawTextFromUpload) is fully unit-tested
// on its own in server/knowledge/whatsapp-import/__tests__/upload-adapter.test.ts.

import {
  analyzeConversationImportHandler,
  processSyncBatchHandler,
  promoteCandidateHandler,
  rejectCandidateHandler,
  startWebsiteSyncHandler,
} from "@/server/application/knowledge-actions";
import { extractRawTextFromUpload } from "@/server/knowledge/whatsapp-import/upload-adapter";

export async function analyzePastedConversationAction(rawInput: unknown) {
  return analyzeConversationImportHandler(rawInput);
}

export async function startWebsiteSyncAction(rawInput: unknown) {
  return startWebsiteSyncHandler(rawInput);
}

export async function processSyncBatchAction(rawInput: unknown) {
  return processSyncBatchHandler(rawInput);
}

export async function promoteCandidateAction(rawInput: unknown) {
  return promoteCandidateHandler(rawInput);
}

export async function rejectCandidateAction(rawInput: unknown) {
  return rejectCandidateHandler(rawInput);
}

export async function analyzeUploadedConversationAction(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false as const, error: { code: "INVALID_INPUT" as const, message: "No se subió ningún archivo." } };
  }

  try {
    const extracted = await extractRawTextFromUpload(file);
    return analyzeConversationImportHandler(extracted);
  } catch (error) {
    return {
      ok: false as const,
      error: { code: "INVALID_INPUT" as const, message: error instanceof Error ? error.message : "No se pudo leer el archivo subido." },
    };
  }
}
