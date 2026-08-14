import { z } from "zod";

// Runtime validation mirroring server/intelligence/types.ts. This is where
// the hallucination-prevention and grounding invariants are structurally
// enforced — not left to prompt instructions or application-code discipline.

export const evidenceSourceTypeSchema = z.enum(["conversation_message", "knowledge_item", "customer_history"]);

export const evidenceSchema = z.object({
  sourceType: evidenceSourceTypeSchema,
  sourceId: z.string().min(1),
  excerpt: z.string().optional(),
});

const confidenceSchema = z.number().min(0).max(1);

// A populated fact/inference (value !== null) must carry at least one
// evidence entry. An unknown value (null) never needs evidence — "unknown"
// is a first-class, always-valid outcome, never penalized the way an
// ungrounded guess would be. Inlined per-factory (rather than a shared
// generic helper) so TS can infer the refine callback's parameter directly
// from each Zod object shape.

// TS cannot structurally match `.refine()`'s callback parameter against a
// concrete shape when the object schema is built from a generic `T extends
// z.ZodTypeAny` (a known TS/Zod generic-inference limitation, not a real
// type hole) — the explicit cast below is scoped to that single check.
type PopulatedCheckShape = { value: unknown; evidence: unknown[] };
const isPopulatedWithEvidence = (entry: unknown) => {
  const { value, evidence } = entry as PopulatedCheckShape;
  return value === null || evidence.length > 0;
};

export function factSchema<T extends z.ZodTypeAny>(valueSchema: T) {
  return z
    .object({
      kind: z.literal("fact"),
      value: valueSchema.nullable(),
      confidence: confidenceSchema,
      evidence: z.array(evidenceSchema),
    })
    .refine(isPopulatedWithEvidence, {
      message: "A populated fact must carry at least one evidence entry.",
      path: ["evidence"],
    });
}

export function inferenceSchema<T extends z.ZodTypeAny>(valueSchema: T) {
  return z
    .object({
      kind: z.literal("inference"),
      value: valueSchema.nullable(),
      confidence: confidenceSchema,
      evidence: z.array(evidenceSchema),
      // Groq (and, plausibly, any provider prompted with "reasoning:
      // string?") commonly emits an explicit `null` for an inference it has
      // nothing to add for, rather than omitting the key — confirmed by
      // real production ProviderResultSchemaError issues, all of the shape
      // "expected string, received null" at inferences.*.reasoning.
      // .nullish() accepts a real string, an explicit null, or the key
      // being entirely absent — the only three shapes a well-behaved
      // provider can produce for an optional narrative field. Every other
      // field's strictness (value/evidence/confidence, grounding refinement)
      // is unchanged.
      reasoning: z.string().nullish(),
    })
    .refine(isPopulatedWithEvidence, {
      message: "A populated inference must carry at least one evidence entry.",
      path: ["evidence"],
    });
}

export const customerIdentificationSchema = z.object({
  isExistingCustomer: z.boolean(),
  matchedLeadId: z.string().nullable(),
  matchConfidence: confidenceSchema,
  matchEvidence: z.array(evidenceSchema),
});

export const factSetSchema = z.object({
  customerName: factSchema(z.string()),
  customerContact: factSchema(z.string()),
  vehicleBrand: factSchema(z.string()),
  vehicleModel: factSchema(z.string()),
  vehicleYear: factSchema(z.number().int()),
  city: factSchema(z.string()),
  quantity: factSchema(z.number().int().positive()),
  productRequested: factSchema(z.string()),
});

export const customerTypeSchema = z.enum(["RETAIL", "WHOLESALE"]);
export const buyingIntentSchema = z.enum(["EXPLORING", "COMPARING", "READY_TO_BUY"]);
export const sentimentSchema = z.enum(["POSITIVE", "NEUTRAL", "FRUSTRATED", "URGENT"]);
export const compatibilitySchema = z.enum(["COMPATIBLE", "INCOMPATIBLE", "UNKNOWN"]);
export const priorityLabelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const estimatedDealValueSchema = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
});

export const recommendedActionSchema = z.object({
  action: z.string().min(1),
  reason: z.string().min(1),
});

export const aiPrioritySchema = z.object({
  score: z.number().min(0).max(100),
  label: priorityLabelSchema,
});

export const inferenceSetSchema = z.object({
  customerType: inferenceSchema(customerTypeSchema),
  productFamily: inferenceSchema(z.string()),
  compatibility: inferenceSchema(compatibilitySchema),
  buyingIntent: inferenceSchema(buyingIntentSchema),
  sentiment: inferenceSchema(sentimentSchema),
  estimatedProbabilityOfPurchase: inferenceSchema(z.number().min(0).max(1)),
  estimatedDealValue: inferenceSchema(estimatedDealValueSchema),
  recommendedNextAction: inferenceSchema(recommendedActionSchema),
  aiPriority: inferenceSchema(aiPrioritySchema),
});

export const objectionSignalSchema = z.object({
  objection: z.string().min(1),
  confidence: confidenceSchema,
  // An objection with no supporting quote is unusable — unlike facts/inferences,
  // there's no "unknown" state for an item that only exists because it was raised.
  evidence: z.array(evidenceSchema).min(1),
});

export const missingFieldEntrySchema = z.object({
  field: z.string().min(1),
  reason: z.string().optional(),
});

export const warningSeveritySchema = z.enum(["info", "warning", "error"]);

export const engineWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  field: z.string().optional(),
  severity: warningSeveritySchema,
});

export const engineRunMetadataSchema = z.object({
  engineSchemaVersion: z.number().int().positive(),
  promptVersion: z.string().min(1),
  modelProvider: z.string().min(1),
  modelName: z.string().min(1),
  analyzedAt: z.date(),
});

export const draftResponseSchema = z.object({
  text: z.string().min(1),
  evidence: z.array(evidenceSchema),
});

export const conversationIntelligenceResultSchema = z.object({
  metadata: engineRunMetadataSchema,
  customerIdentification: customerIdentificationSchema,
  facts: factSetSchema,
  inferences: inferenceSetSchema,
  objections: z.array(objectionSignalSchema),
  missingInformation: z.array(missingFieldEntrySchema),
  warnings: z.array(engineWarningSchema),
  draftResponse: draftResponseSchema.nullable(),
  overallConfidence: confidenceSchema,
});

// The shape an AI provider is asked to produce: everything in the final
// result except `metadata` (added by the pipeline, never by the model) and
// with `overallConfidence` optional and untrusted — the pipeline always
// recomputes it deterministically (see confidence.ts) and never reads this
// value through to the final result.
export const providerResultSchema = conversationIntelligenceResultSchema
  .omit({ metadata: true })
  .extend({ overallConfidence: confidenceSchema.optional() });

export type ProviderResult = z.infer<typeof providerResultSchema>;

export const channelTypeSchema = z.enum(["whatsapp", "messenger", "instagram", "email", "manual"]);

export const normalizedMessageSchema = z.object({
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  content: z.string().min(1),
  occurredAt: z.date(),
  authorLabel: z.string().optional(),
});

export const conversationIntelligenceInputSchema = z
  .object({
    tenantId: z.string().min(1),
    channel: channelTypeSchema,
    rawText: z.string().optional(),
    messages: z.array(normalizedMessageSchema).optional(),
    knownCustomerId: z.string().optional(),
  })
  .refine((input) => Boolean(input.rawText?.length) || Boolean(input.messages?.length), {
    message: "Either rawText or messages must be provided.",
    path: ["rawText"],
  });
