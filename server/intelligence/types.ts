// Kori's Conversation Intelligence Engine — public contracts.
//
// These types are the single source of truth for the engine's shape.
// server/intelligence/schema.ts provides runtime (Zod) validation of the
// same shape; keep the two in sync — server/intelligence/__tests__ verifies
// they agree.

export type EvidenceSourceType = "conversation_message" | "knowledge_item" | "customer_history";

export interface Evidence {
  sourceType: EvidenceSourceType;
  sourceId: string;
  excerpt?: string;
}

/**
 * A directly-observed, verifiable claim (a quote or an exact lookup match).
 * `kind: "fact"` is a literal discriminant — it exists so a Fact can never
 * be structurally substituted for an Inference, or vice versa.
 */
export interface Fact<T> {
  kind: "fact";
  value: T | null;
  confidence: number;
  evidence: Evidence[];
}

/**
 * A judgment, classification, or prediction derived from facts + context.
 * Must never be presented as a confirmed fact — `kind: "inference"` makes
 * that a type-level guarantee, not just a naming convention.
 */
export interface Inference<T> {
  kind: "inference";
  value: T | null;
  confidence: number;
  evidence: Evidence[];
  reasoning?: string;
}

export interface CustomerIdentification {
  isExistingCustomer: boolean;
  matchedLeadId: string | null;
  matchConfidence: number;
  matchEvidence: Evidence[];
}

export interface FactSet {
  customerName: Fact<string>;
  customerContact: Fact<string>;
  vehicleBrand: Fact<string>;
  vehicleModel: Fact<string>;
  vehicleYear: Fact<number>;
  city: Fact<string>;
  quantity: Fact<number>;
  productRequested: Fact<string>;
}

export type CustomerType = "RETAIL" | "WHOLESALE";
export type BuyingIntent = "EXPLORING" | "COMPARING" | "READY_TO_BUY";
export type Sentiment = "POSITIVE" | "NEUTRAL" | "FRUSTRATED" | "URGENT";
export type Compatibility = "COMPATIBLE" | "INCOMPATIBLE" | "UNKNOWN";
export type PriorityLabel = "LOW" | "MEDIUM" | "HIGH";

export interface EstimatedDealValue {
  amount: number;
  currency: string;
}

export interface RecommendedAction {
  action: string;
  reason: string;
}

export interface AiPriority {
  score: number;
  label: PriorityLabel;
}

export interface InferenceSet {
  customerType: Inference<CustomerType>;
  productFamily: Inference<string>;
  compatibility: Inference<Compatibility>;
  buyingIntent: Inference<BuyingIntent>;
  sentiment: Inference<Sentiment>;
  estimatedProbabilityOfPurchase: Inference<number>;
  estimatedDealValue: Inference<EstimatedDealValue>;
  recommendedNextAction: Inference<RecommendedAction>;
  aiPriority: Inference<AiPriority>;
}

export interface ObjectionSignal {
  objection: string;
  confidence: number;
  evidence: Evidence[];
}

export interface MissingFieldEntry {
  field: string;
  reason?: string;
}

export type WarningSeverity = "info" | "warning" | "error";

export interface EngineWarning {
  code: string;
  message: string;
  field?: string;
  severity: WarningSeverity;
}

export interface EngineRunMetadata {
  engineSchemaVersion: number;
  promptVersion: string;
  modelProvider: string;
  modelName: string;
  analyzedAt: Date;
}

export interface DraftResponse {
  text: string;
  evidence: Evidence[];
}

/**
 * The engine's complete, persistable output. This is the full audit trail —
 * facts, inferences, evidence, unknowns, per-field confidence, warnings, and
 * run metadata — not just a commercial summary. Everything here is intended
 * to be stored verbatim (see Conversation.extractedData in a later phase).
 */
export interface ConversationIntelligenceResult {
  metadata: EngineRunMetadata;
  customerIdentification: CustomerIdentification;
  facts: FactSet;
  inferences: InferenceSet;
  objections: ObjectionSignal[];
  missingInformation: MissingFieldEntry[];
  warnings: EngineWarning[];
  draftResponse: DraftResponse | null;
  /** Derived convenience aggregate for sorting/display — never the source of truth; per-field confidence is. */
  overallConfidence: number;
}

export type ChannelType = "whatsapp" | "messenger" | "instagram" | "email" | "manual";

export interface NormalizedMessage {
  direction: "INBOUND" | "OUTBOUND";
  content: string;
  occurredAt: Date;
  authorLabel?: string;
}

export interface ConversationIntelligenceInput {
  tenantId: string;
  channel: ChannelType;
  /** Raw pasted text — today's only real ingestion path. */
  rawText?: string;
  /** Pre-normalized messages — future channel-API ingestion path. */
  messages?: NormalizedMessage[];
  /** A hint for identity resolution, never an authority. */
  knownCustomerId?: string;
}
