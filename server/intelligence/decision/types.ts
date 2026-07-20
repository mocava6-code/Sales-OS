// Kori's Decision Engine — public contracts.
//
// Consumes Conversation Intelligence output (and other verified context) and
// proposes structured, explainable commercial decisions. Reuses the CIE's
// Evidence/Fact/Inference/MissingFieldEntry/EngineWarning primitives rather
// than reinventing them — the same grounding vocabulary applies here.

import { createHash } from "node:crypto";
import type {
  ConversationIntelligenceResult,
  Evidence,
  EngineWarning,
  Inference,
  MissingFieldEntry,
  NormalizedMessage,
} from "../types";

// --- Input context ---------------------------------------------------------

/** A verified, evidenced fact supplied outside the current conversation (e.g. a business-rule lookup). */
export interface NamedFact {
  key: string;
  value: string;
  evidence: Evidence[];
}

export interface KoriBusinessRule {
  key: string;
  description: string;
}

export interface AdvisorContext {
  advisorId?: string;
  advisorName?: string;
  /** Free-text notes the advisor has already logged about this conversation, if any. */
  notes?: string;
}

export interface PreviousInteractionSummary {
  occurredAt: Date;
  summary: string;
  outcome?: string;
}

export interface PendingTask {
  description: string;
  dueAt?: Date;
}

/**
 * Everything Kori may use to reason about one conversation right now. Every
 * field except `conversationId` is optional — the engine must work with
 * partial context, and the pipeline separately enforces that *some* usable
 * signal exists (see CriticalInformationMissingError in ./errors.ts).
 *
 * Verified facts, inferences, and unknowns are kept in clearly separate
 * shapes here — never flattened into one untrusted bag:
 *   - conversationIntelligence.facts / knownCustomerFacts / knownProductFacts / knownBusinessRules -> verified
 *   - conversationIntelligence.inferences -> AI inferences, already carrying confidence + evidence
 *   - anything absent -> unknown, surfaced later via missingInformation, never guessed
 */
export interface KoriDecisionContext {
  conversationId: string;
  leadId?: string;
  customerId?: string;

  conversationIntelligence?: ConversationIntelligenceResult;
  recentMessages?: NormalizedMessage[];
  conversationSummary?: string;

  knownCustomerFacts?: NamedFact[];
  knownProductFacts?: NamedFact[];
  knownBusinessRules?: KoriBusinessRule[];

  advisorContext?: AdvisorContext;
  previousInteractions?: PreviousInteractionSummary[];
  pendingTasks?: PendingTask[];

  metadata?: Record<string, string>;
}

// --- Decision output ---------------------------------------------------------

export type DecisionType =
  | "RESPOND_TO_CUSTOMER"
  | "ASK_CLARIFYING_QUESTION"
  | "FOLLOW_UP"
  | "ESCALATE_TO_HUMAN"
  | "RECOMMEND_SALES_APPROACH"
  | "WARN_ADVISOR"
  | "ORGANIZE_CONVERSATION"
  | "WAIT"
  | "NO_ACTION";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ImpactLevel = "LOW" | "MEDIUM" | "HIGH";

export type ApprovalRequirement =
  | "AUTO_ALLOWED"
  | "ADVISOR_APPROVAL_REQUIRED"
  | "ADMIN_APPROVAL_REQUIRED"
  | "HUMAN_INFORMATION_REQUIRED";

/**
 * OVERRIDDEN is distinct from REJECTED: a rejection means the advisor said
 * no and did nothing; an override means the advisor acted, just not on
 * Kori's recommendation (see server/orchestration/decision-workflows.ts'
 * recordAdvisorOverride).
 */
export type DecisionStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "EXECUTED" | "CANCELLED" | "OVERRIDDEN";

/**
 * Observable commercial behavior only — never a protected or sensitive
 * personal characteristic. A trait is always an Inference<T>: a hypothesis
 * with its own confidence and evidence, never presented as fact.
 */
export type CommercialProfileTrait =
  | "PRICE_FOCUSED"
  | "TECHNICAL"
  | "DISTRUSTFUL"
  | "URGENT"
  | "COMPARISON_SHOPPING"
  | "LOW_ENGAGEMENT"
  | "DECISIVE"
  | "NEEDS_REASSURANCE"
  | "RESPONDS_TO_DIRECT_COMMUNICATION"
  | "RESPONDS_TO_CONSULTATIVE_COMMUNICATION";

export interface CustomerProfileInference {
  traits: Inference<CommercialProfileTrait>[];
}

export interface DecisionAlternative {
  title: string;
  recommendation: string;
  reasoning?: string;
  /** Why this alternative wasn't chosen as the primary recommendation. */
  tradeoff?: string;
}

export interface SuggestedAction {
  /** Free-text description of the concrete next step. Never executable in this phase. */
  description: string;
  /** Set deterministically by the policy evaluator — informational only; nothing executes it here. */
  autoPerformable: boolean;
}

export interface KoriDecisionMetadata {
  engineSchemaVersion: number;
  promptVersion: string;
  aiProvider: string;
  modelName: string;
  decidedAt: Date;
  conversationId: string;
  /** Correlates this decision to the specific Conversation Intelligence run that informed it, if any. */
  sourceConversationIntelligenceGeneratedAt?: Date;
}

/**
 * One structured, explainable commercial decision. Deliberately compatible
 * with future outcome tracking (a Learning Engine, not built yet): `id`,
 * `metadata.conversationId`, and `metadata.decidedAt` are stable enough for
 * a future module to join against "did the advisor follow this, what
 * happened next" — nothing here fakes or stubs that behavior.
 */
export interface KoriDecision {
  id: string;
  type: DecisionType;
  title: string;
  recommendation: string;
  objective: string;
  reasoning: string;
  evidence: Evidence[];
  assumptions: string[];
  missingInformation: MissingFieldEntry[];
  alternatives: DecisionAlternative[];
  confidence: number;
  riskLevel: RiskLevel;
  impactLevel: ImpactLevel;
  approvalRequirement: ApprovalRequirement;
  suggestedAction: SuggestedAction;
  status: DecisionStatus;
  /** The customer's probable commercial profile, if the reasoning used one — a hypothesis, not a fact. */
  customerProfile?: CustomerProfileInference;
  /** Grounding/validation warnings specific to this decision (see ./validator.ts) — never silently dropped. */
  warnings: EngineWarning[];
  metadata: KoriDecisionMetadata;
}

// --- Raw AI reasoning output (before validation/risk/policy) ----------------

/**
 * What DecisionReasoningCapability is asked to produce. Deliberately
 * excludes riskLevel, impactLevel, approvalRequirement, status, id, and
 * metadata — those are never the AI's to decide (see ./risk-evaluator.ts
 * and ./policy-evaluator.ts).
 */
export interface DecisionProposal {
  type: DecisionType;
  title: string;
  recommendation: string;
  objective: string;
  reasoning: string;
  evidence: Evidence[];
  assumptions: string[];
  missingInformation: MissingFieldEntry[];
  alternatives: DecisionAlternative[];
  confidence: number;
  suggestedActionDescription: string;
}

export interface CustomerProfileTraitProposal {
  trait: CommercialProfileTrait;
  confidence: number;
  evidence: Evidence[];
  reasoning?: string;
}

export interface DecisionReasoningOutput {
  decisions: DecisionProposal[];
  customerProfileTraits?: CustomerProfileTraitProposal[];
}

// --- Shared helpers ----------------------------------------------------------

export const DECISION_ENGINE_SCHEMA_VERSION = 1;

/**
 * Deterministic, not random — the same (conversationId, type, index) always
 * produces the same id, which matters for idempotency and reproducible
 * tests. Not a persistence key; a future storage layer may mint its own.
 */
export function makeDecisionId(conversationId: string, type: DecisionType, index: number): string {
  const hash = createHash("sha256").update(`${conversationId}:${type}:${index}`).digest("hex").slice(0, 16);
  return `decision_${hash}`;
}
