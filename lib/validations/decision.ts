import { z } from "zod";

export const decisionRecordIdSchema = z.string().min(1, { error: "Se requiere un id de decisión." });
export const conversationIdSchema = z.string().min(1, { error: "Se requiere un id de conversación." });

const optionalNoteSchema = z.string().trim().max(2000).optional();
const requiredNoteSchema = z
  .string()
  .trim()
  .min(1, { error: "Se requiere una nota breve." })
  .max(2000, { error: "La nota no puede superar los 2000 caracteres." });

export const advisorActionTypeSchema = z.enum([
  "FOLLOWED_RECOMMENDATION",
  "IGNORED_RECOMMENDATION",
  "PARTIALLY_FOLLOWED_RECOMMENDATION",
  "CUSTOM_ACTION",
]);

const optionalAdvisorActionSchema = z
  .object({
    actionType: advisorActionTypeSchema,
    notes: optionalNoteSchema,
  })
  .optional();

export const approveDecisionSchema = z.object({
  decisionRecordId: decisionRecordIdSchema,
  note: optionalNoteSchema,
  advisorAction: optionalAdvisorActionSchema,
});

// Required note: rejecting.
export const rejectDecisionSchema = z.object({
  decisionRecordId: decisionRecordIdSchema,
  note: requiredNoteSchema,
  advisorAction: optionalAdvisorActionSchema,
});

export const executeDecisionSchema = z.object({
  decisionRecordId: decisionRecordIdSchema,
  note: optionalNoteSchema,
  advisorAction: optionalAdvisorActionSchema,
});

// Required note: overriding / choosing an alternative.
export const recordAdvisorOverrideSchema = z.object({
  decisionRecordId: decisionRecordIdSchema,
  actionType: advisorActionTypeSchema,
  notes: requiredNoteSchema,
});

export const outcomeAttributionSchema = z.enum(["KORI_RECOMMENDATION", "ADVISOR_ALTERNATIVE", "UNATTRIBUTED"]);

const baseOutcomeSchema = z.object({
  decisionRecordId: decisionRecordIdSchema,
  notes: optionalNoteSchema,
  occurredAt: z.coerce.date().optional(),
});

export const recordOutcomeSchema = baseOutcomeSchema.extend({
  attribution: outcomeAttributionSchema.optional(),
});

// SALE_CLOSED / SALE_LOST always require an explicit attribution.
export const recordSaleOutcomeSchema = baseOutcomeSchema.extend({
  attribution: outcomeAttributionSchema,
});

export const analyzeConversationSchema = z.object({
  conversationId: conversationIdSchema,
});

export type ApproveDecisionActionInput = z.infer<typeof approveDecisionSchema>;
export type RejectDecisionActionInput = z.infer<typeof rejectDecisionSchema>;
export type ExecuteDecisionActionInput = z.infer<typeof executeDecisionSchema>;
export type RecordAdvisorOverrideActionInput = z.infer<typeof recordAdvisorOverrideSchema>;
export type RecordOutcomeActionInput = z.infer<typeof recordOutcomeSchema>;
export type RecordSaleOutcomeActionInput = z.infer<typeof recordSaleOutcomeSchema>;
export type AnalyzeConversationActionInput = z.infer<typeof analyzeConversationSchema>;
