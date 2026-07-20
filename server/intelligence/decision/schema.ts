import { z } from "zod";
import { engineWarningSchema, evidenceSchema, inferenceSchema, missingFieldEntrySchema } from "../schema";

// Runtime validation for the Decision Engine, mirroring server/intelligence/schema.ts's
// role and reusing its evidence/inference/warning building blocks directly.

const confidenceSchema = z.number().min(0).max(1);

export const decisionTypeSchema = z.enum([
  "RESPOND_TO_CUSTOMER",
  "ASK_CLARIFYING_QUESTION",
  "FOLLOW_UP",
  "ESCALATE_TO_HUMAN",
  "RECOMMEND_SALES_APPROACH",
  "WARN_ADVISOR",
  "ORGANIZE_CONVERSATION",
  "WAIT",
  "NO_ACTION",
]);

export const riskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const impactLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const approvalRequirementSchema = z.enum([
  "AUTO_ALLOWED",
  "ADVISOR_APPROVAL_REQUIRED",
  "ADMIN_APPROVAL_REQUIRED",
  "HUMAN_INFORMATION_REQUIRED",
]);
export const decisionStatusSchema = z.enum(["PROPOSED", "APPROVED", "REJECTED", "EXECUTED", "CANCELLED", "OVERRIDDEN"]);

export const commercialProfileTraitSchema = z.enum([
  "PRICE_FOCUSED",
  "TECHNICAL",
  "DISTRUSTFUL",
  "URGENT",
  "COMPARISON_SHOPPING",
  "LOW_ENGAGEMENT",
  "DECISIVE",
  "NEEDS_REASSURANCE",
  "RESPONDS_TO_DIRECT_COMMUNICATION",
  "RESPONDS_TO_CONSULTATIVE_COMMUNICATION",
]);

export const decisionAlternativeSchema = z.object({
  title: z.string().min(1),
  recommendation: z.string().min(1),
  reasoning: z.string().optional(),
  tradeoff: z.string().optional(),
});

export const suggestedActionSchema = z.object({
  description: z.string().min(1),
  autoPerformable: z.boolean(),
});

// --- Raw AI reasoning output (before validation/risk/policy) ----------------

export const decisionProposalSchema = z.object({
  type: decisionTypeSchema,
  title: z.string().min(1),
  recommendation: z.string().min(1),
  objective: z.string().min(1),
  reasoning: z.string().min(1),
  evidence: z.array(evidenceSchema),
  assumptions: z.array(z.string()),
  missingInformation: z.array(missingFieldEntrySchema),
  alternatives: z.array(decisionAlternativeSchema),
  confidence: confidenceSchema,
  suggestedActionDescription: z.string().min(1),
});

export const customerProfileTraitProposalSchema = z.object({
  trait: commercialProfileTraitSchema,
  confidence: confidenceSchema,
  evidence: z.array(evidenceSchema),
  reasoning: z.string().optional(),
});

export const decisionReasoningOutputSchema = z.object({
  decisions: z.array(decisionProposalSchema).min(1),
  customerProfileTraits: z.array(customerProfileTraitProposalSchema).optional(),
});

// --- Final decision shape ----------------------------------------------------

export const customerProfileInferenceSchema = z.object({
  traits: z.array(inferenceSchema(commercialProfileTraitSchema)),
});

export const koriDecisionMetadataSchema = z.object({
  engineSchemaVersion: z.number().int().positive(),
  promptVersion: z.string().min(1),
  aiProvider: z.string().min(1),
  modelName: z.string().min(1),
  decidedAt: z.date(),
  conversationId: z.string().min(1),
  sourceConversationIntelligenceGeneratedAt: z.date().optional(),
});

export const koriDecisionSchema = z.object({
  id: z.string().min(1),
  type: decisionTypeSchema,
  title: z.string().min(1),
  recommendation: z.string().min(1),
  objective: z.string().min(1),
  reasoning: z.string().min(1),
  evidence: z.array(evidenceSchema),
  assumptions: z.array(z.string()),
  missingInformation: z.array(missingFieldEntrySchema),
  alternatives: z.array(decisionAlternativeSchema),
  confidence: confidenceSchema,
  riskLevel: riskLevelSchema,
  impactLevel: impactLevelSchema,
  approvalRequirement: approvalRequirementSchema,
  suggestedAction: suggestedActionSchema,
  status: decisionStatusSchema,
  customerProfile: customerProfileInferenceSchema.optional(),
  warnings: z.array(engineWarningSchema),
  metadata: koriDecisionMetadataSchema,
});

// --- Input context (light validation — only conversationId is required) ----

export const koriDecisionContextSchema = z
  .object({
    conversationId: z.string().min(1),
    leadId: z.string().optional(),
    customerId: z.string().optional(),
    conversationIntelligence: z.unknown().optional(),
    recentMessages: z.array(z.unknown()).optional(),
    conversationSummary: z.string().optional(),
    knownCustomerFacts: z.array(z.unknown()).optional(),
    knownProductFacts: z.array(z.unknown()).optional(),
    knownBusinessRules: z.array(z.unknown()).optional(),
    advisorContext: z.unknown().optional(),
    previousInteractions: z.array(z.unknown()).optional(),
    pendingTasks: z.array(z.unknown()).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();
