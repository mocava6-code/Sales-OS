// Orchestration-layer domain contracts. Prisma-free — the only persistence
// type referenced anywhere here is TransactionRunner, itself Prisma-free
// (see server/persistence/unit-of-work.ts). Reuses the engines' own domain
// objects (ConversationIntelligenceResult, KoriDecisionContext,
// SavedDecisionRecord, ...) rather than reinventing them.

import type { AnalyzeConversationDependencies } from "../intelligence/analyze-conversation";
import type { KoriDecisionContext } from "../intelligence/decision/types";
import type { ConversationIntelligenceInput, ConversationIntelligenceResult, EngineWarning } from "../intelligence/types";
import type {
  AdvisorActionRecord,
  AdvisorActionType,
  DecisionEventRecord,
  OutcomeAttribution,
  OutcomeRecord,
  SavedDecisionRecord,
} from "../persistence/types";
import type { TransactionRunner } from "../persistence/unit-of-work";

// --- Primary workflow: analyzeConversationAndCreateDecisions -----------------

export interface AnalyzeConversationAndCreateDecisionsInput {
  businessId: string;
  /** The CRM Conversation this analysis run is about — must already exist. */
  conversationId: string;
  conversationIntelligenceInput: ConversationIntelligenceInput;
  /**
   * Decision Engine context beyond what the Conversation Intelligence result
   * already supplies (advisor notes, known business rules, prior
   * interactions, ...). `conversationId` and `conversationIntelligence` are
   * always set by the workflow itself — never accepted here.
   */
  decisionContext?: Omit<Partial<KoriDecisionContext>, "conversationId" | "conversationIntelligence">;
}

export interface AnalyzeConversationAndCreateDecisionsDependencies extends AnalyzeConversationDependencies {
  transactionRunner: TransactionRunner;
}

export interface AnalyzeConversationAndCreateDecisionsResult {
  conversationIntelligence: ConversationIntelligenceResult;
  conversationSnapshotId: string;
  decisions: SavedDecisionRecord[];
  events: DecisionEventRecord[];
  /** conversationIntelligence.warnings + every persisted decision's own warnings, flattened for convenience. */
  warnings: EngineWarning[];
}

// --- Advisor decision workflows -----------------------------------------------

export interface DecisionWorkflowDependencies {
  transactionRunner: TransactionRunner;
  /** Defaults to `() => new Date()`. Injectable for deterministic tests. */
  clock?: () => Date;
}

export interface AdvisorActionInput {
  actionType: AdvisorActionType;
  advisorUserId?: string;
  notes?: string;
}

export interface ApproveDecisionInput {
  decisionRecordId: string;
  note?: string;
  /** Optional — most approvals don't need a separate AdvisorAction row. */
  advisorAction?: AdvisorActionInput;
}

export interface RejectDecisionInput {
  decisionRecordId: string;
  note?: string;
  advisorAction?: AdvisorActionInput;
}

export interface ExecuteDecisionInput {
  decisionRecordId: string;
  note?: string;
  advisorAction?: AdvisorActionInput;
}

export interface RecordAdvisorOverrideInput {
  decisionRecordId: string;
  /** Unlike the other three workflows, an override always logs *what the advisor did instead*. */
  actionType: AdvisorActionType;
  advisorUserId?: string;
  notes?: string;
}

export interface DecisionWorkflowResult {
  decision: SavedDecisionRecord;
  event: DecisionEventRecord;
  advisorAction?: AdvisorActionRecord;
}

// --- Outcome workflows ---------------------------------------------------------

export interface OutcomeWorkflowDependencies {
  transactionRunner: TransactionRunner;
  /** Defaults to `() => new Date()`. Injectable for deterministic tests. */
  clock?: () => Date;
}

export interface RecordOutcomeWorkflowInput {
  decisionRecordId: string;
  /**
   * Required for SALE_CLOSED/SALE_LOST; required for any outcome type when
   * the decision is REJECTED/OVERRIDDEN/CANCELLED (and must then be
   * ADVISOR_ALTERNATIVE or UNATTRIBUTED, never KORI_RECOMMENDATION) —
   * enforced by server/orchestration/outcome-attribution-policy.ts. Optional
   * everywhere else.
   */
  attribution?: OutcomeAttribution;
  notes?: string;
  occurredAt?: Date;
}

export interface OutcomeWorkflowResult {
  outcome: OutcomeRecord;
  /** Only set for outcome types that have a corresponding DecisionEventType (see ./outcome-workflows.ts). */
  event?: DecisionEventRecord;
}
