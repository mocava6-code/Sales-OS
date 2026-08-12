import { z } from "zod";
import { actionReasonCodeSchema } from "./reason-codes";

// Runtime validation for the AI layer's raw output — mirrors
// server/intelligence/decision/schema.ts's role for the Decision Engine.
// Strict on purpose: an AI response with an extra/unexpected key is
// rejected outright rather than silently accepted, same as every other
// AI-facing schema in this codebase.

export const actionStateValueSchema = z.enum(["REPLY_REQUIRED", "FOLLOW_UP_REQUIRED", "WAITING_ON_CUSTOMER", "NO_ACTION_REQUIRED", "UNCERTAIN"]);

export const conversationActionClassificationOutputSchema = z
  .object({
    actionState: actionStateValueSchema,
    reasonCode: actionReasonCodeSchema,
    confidence: z.number().min(0).max(1),
    reasoning: z.string().min(1),
    evidenceEntryIds: z.array(z.string()),
    recommendedAction: z.string().nullable(),
  })
  .strict();

export type ConversationActionClassificationOutput = z.infer<typeof conversationActionClassificationOutputSchema>;
