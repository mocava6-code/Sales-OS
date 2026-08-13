import { z } from "zod";

// Phase 4 — bounds enforced again here at the application-input boundary
// (mirrors lib/validations/kori.ts), before ever reaching
// runResponseActionAIBatch (server/services/response-action-ai-batch-service.ts,
// which enforces its own MAX_BATCH_SIZE independently — belt and suspenders).
const MAX_BATCH_SIZE = 25;

export const runResponseActionAIBatchSchema = z.object({
  batchSize: z.number().int().min(1).max(MAX_BATCH_SIZE).default(5),
  /** false (default) = classify only, never write. true = persist via projectConversationActionState (the actual backfill). */
  persist: z.boolean().default(false),
});

// Phase 7 (human override) — the four advisor-facing labels the mission
// specifies verbatim ("Requiere respuesta" / "Necesita seguimiento" /
// "Esperando al cliente" / "No requiere acción"), kept as one closed enum
// rather than accepting a raw (actionState, reasonCode) pair — that would
// let a caller submit a mismatched combination (e.g. actionState
// NO_ACTION_REQUIRED with a FOLLOW_UP reasonCode); the mapping from label
// to the matching pair lives in server/application/response-action-actions.ts.
export const CONVERSATION_ACTION_OVERRIDE_LABELS = ["REQUIERE_RESPUESTA", "NECESITA_SEGUIMIENTO", "ESPERANDO_CLIENTE", "NO_REQUIERE_ACCION"] as const;

export const setConversationActionOverrideSchema = z.object({
  conversationId: z.string().min(1, { error: "conversationId is required." }),
  label: z.enum(CONVERSATION_ACTION_OVERRIDE_LABELS),
});
