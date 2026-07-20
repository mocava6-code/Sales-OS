// Serialization-safe DTOs returned to the client. Nothing here is a Prisma
// type or a KoriDecision accepted as input — these are read-only view
// shapes built server-side from authoritative records. promptVersion is a
// short version label (e.g. "kori-decision-v1"), never the prompt text
// itself, so it's safe to include in the "technical section" the UI shows.

import type {
  ApprovalRequirement,
  CustomerProfileInference,
  DecisionAlternative,
  DecisionStatus,
  DecisionType,
  ImpactLevel,
  RiskLevel,
  SuggestedAction,
} from "@/server/intelligence/decision/types";
import type { Evidence, EngineWarning, MissingFieldEntry } from "@/server/intelligence/types";
import type { AnalyzeConversationAndCreateDecisionsResult } from "@/server/orchestration/types";
import type { OutcomeAttribution, OutcomeRecord, OutcomeType, SavedDecisionRecord } from "@/server/persistence/types";
import type { PendingWhatsAppMessage as PendingWhatsAppMessageRow } from "@/server/db/generated/client";

export interface DecisionSummaryDTO {
  id: string;
  conversationId: string;
  conversationSnapshotId: string | null;
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
  customerProfile?: CustomerProfileInference;
  warnings: EngineWarning[];
  metadata: {
    engineSchemaVersion: number;
    promptVersion: string;
    aiProvider: string;
    modelName: string;
    decidedAt: Date;
  };
  createdAt: Date;
}

export function toDecisionSummaryDTO(saved: SavedDecisionRecord): DecisionSummaryDTO {
  const { decision } = saved;
  return {
    id: saved.id,
    conversationId: saved.conversationId,
    conversationSnapshotId: saved.conversationSnapshotId,
    type: decision.type,
    title: decision.title,
    recommendation: decision.recommendation,
    objective: decision.objective,
    reasoning: decision.reasoning,
    evidence: decision.evidence,
    assumptions: decision.assumptions,
    missingInformation: decision.missingInformation,
    alternatives: decision.alternatives,
    confidence: decision.confidence,
    riskLevel: decision.riskLevel,
    impactLevel: decision.impactLevel,
    approvalRequirement: decision.approvalRequirement,
    suggestedAction: decision.suggestedAction,
    status: decision.status,
    customerProfile: decision.customerProfile,
    warnings: decision.warnings,
    metadata: {
      engineSchemaVersion: decision.metadata.engineSchemaVersion,
      promptVersion: decision.metadata.promptVersion,
      aiProvider: decision.metadata.aiProvider,
      modelName: decision.metadata.modelName,
      decidedAt: decision.metadata.decidedAt,
    },
    createdAt: saved.createdAt,
  };
}

export interface OutcomeSummaryDTO {
  id: string;
  decisionRecordId: string;
  outcomeType: OutcomeType;
  attribution: OutcomeAttribution | null;
  notes: string | null;
  occurredAt: Date;
}

export function toOutcomeSummaryDTO(record: OutcomeRecord): OutcomeSummaryDTO {
  return {
    id: record.id,
    decisionRecordId: record.decisionRecordId,
    outcomeType: record.outcomeType,
    attribution: record.attribution,
    notes: record.notes,
    occurredAt: record.occurredAt,
  };
}

export interface AnalyzeConversationSummaryDTO {
  conversationSnapshotId: string;
  decisions: DecisionSummaryDTO[];
  warnings: EngineWarning[];
}

export function toAnalyzeConversationSummaryDTO(
  result: AnalyzeConversationAndCreateDecisionsResult,
): AnalyzeConversationSummaryDTO {
  return {
    conversationSnapshotId: result.conversationSnapshotId,
    decisions: result.decisions.map(toDecisionSummaryDTO),
    warnings: result.warnings,
  };
}

export interface PendingWhatsAppMessageSummaryDTO {
  id: string;
  conversationId: string;
  toPhoneNumber: string;
  body: string;
  status: PendingWhatsAppMessageRow["status"];
  decisionRecordId: string | null;
  externalId: string | null;
  failureReason: string | null;
  createdAt: Date;
  sentAt: Date | null;
}

export function toPendingWhatsAppMessageSummaryDTO(row: PendingWhatsAppMessageRow): PendingWhatsAppMessageSummaryDTO {
  return {
    id: row.id,
    conversationId: row.conversationId,
    toPhoneNumber: row.toPhoneNumber,
    body: row.body,
    status: row.status,
    decisionRecordId: row.decisionRecordId,
    externalId: row.externalId,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
  };
}
