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
