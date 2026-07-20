// Row <-> domain object mapping. This is the only place in the codebase
// that knows both a Prisma row shape and an engine domain type at once —
// every Prisma*Repository delegates to these functions instead of mapping
// inline, so the mapping logic is verified once (see ../../__tests__
// "repository mapping" coverage) rather than duplicated per repository.

import { Prisma } from "../../db/generated/client";
import type {
  ConversationSnapshot as ConversationSnapshotRow,
  DecisionRecord as DecisionRecordRow,
  DecisionEvent as DecisionEventRow,
  AdvisorAction as AdvisorActionRow,
  Outcome as OutcomeRow,
} from "../../db/generated/client";
import type { ConversationIntelligenceResult } from "../../intelligence/types";
import type { KoriDecision } from "../../intelligence/decision/types";
import type {
  AdvisorActionRecord,
  DecisionEventRecord,
  OutcomeRecord,
  SavedConversationSnapshot,
  SavedDecisionRecord,
} from "../types";

/** Cast helper for the write side: our domain types are always plain JSON-safe data. */
export function toInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/** Same as toInputJson, but for optional Json columns where "absent" must persist as a real SQL NULL. */
export function toNullableInputJson(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

export function toConversationSnapshotDomain(row: ConversationSnapshotRow): SavedConversationSnapshot {
  const result: ConversationIntelligenceResult = {
    metadata: {
      engineSchemaVersion: row.engineSchemaVersion,
      promptVersion: row.promptVersion,
      modelProvider: row.aiProvider,
      modelName: row.modelName,
      analyzedAt: row.analyzedAt,
    },
    customerIdentification: row.customerIdentification as unknown as ConversationIntelligenceResult["customerIdentification"],
    facts: row.facts as unknown as ConversationIntelligenceResult["facts"],
    inferences: row.inferences as unknown as ConversationIntelligenceResult["inferences"],
    objections: row.objections as unknown as ConversationIntelligenceResult["objections"],
    missingInformation: row.missingInformation as unknown as ConversationIntelligenceResult["missingInformation"],
    warnings: row.warnings as unknown as ConversationIntelligenceResult["warnings"],
    draftResponse: row.draftResponse as unknown as ConversationIntelligenceResult["draftResponse"],
    overallConfidence: row.overallConfidence,
  };

  return {
    id: row.id,
    businessId: row.businessId,
    conversationId: row.conversationId,
    result,
    createdAt: row.createdAt,
  };
}

export function toDecisionRecordDomain(row: DecisionRecordRow): SavedDecisionRecord {
  const decision: KoriDecision = {
    id: row.engineDecisionId,
    type: row.type,
    title: row.title,
    recommendation: row.recommendation,
    objective: row.objective,
    reasoning: row.reasoning,
    evidence: row.evidence as unknown as KoriDecision["evidence"],
    assumptions: row.assumptions,
    missingInformation: row.missingInformation as unknown as KoriDecision["missingInformation"],
    alternatives: row.alternatives as unknown as KoriDecision["alternatives"],
    confidence: row.confidence,
    riskLevel: row.riskLevel,
    impactLevel: row.impactLevel,
    approvalRequirement: row.approvalRequirement,
    suggestedAction: row.suggestedAction as unknown as KoriDecision["suggestedAction"],
    status: row.status,
    customerProfile: row.customerProfile as unknown as KoriDecision["customerProfile"],
    warnings: row.warnings as unknown as KoriDecision["warnings"],
    metadata: {
      engineSchemaVersion: row.engineSchemaVersion,
      promptVersion: row.promptVersion,
      aiProvider: row.aiProvider,
      modelName: row.modelName,
      decidedAt: row.decidedAt,
      conversationId: row.conversationId,
      sourceConversationIntelligenceGeneratedAt: row.sourceConversationIntelligenceGeneratedAt ?? undefined,
    },
  };

  return {
    id: row.id,
    businessId: row.businessId,
    conversationId: row.conversationId,
    conversationSnapshotId: row.conversationSnapshotId,
    decision,
    createdAt: row.createdAt,
  };
}

export function toDecisionEventDomain(row: DecisionEventRow): DecisionEventRecord {
  return {
    id: row.id,
    decisionRecordId: row.decisionRecordId,
    eventType: row.eventType,
    occurredAt: row.occurredAt,
    note: row.note,
    createdAt: row.createdAt,
  };
}

export function toAdvisorActionDomain(row: AdvisorActionRow): AdvisorActionRecord {
  return {
    id: row.id,
    decisionRecordId: row.decisionRecordId,
    actionType: row.actionType,
    advisorUserId: row.advisorUserId,
    notes: row.notes,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
  };
}

export function toOutcomeDomain(row: OutcomeRow): OutcomeRecord {
  return {
    id: row.id,
    decisionRecordId: row.decisionRecordId,
    outcomeType: row.outcomeType,
    attribution: row.attribution,
    notes: row.notes,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
  };
}
