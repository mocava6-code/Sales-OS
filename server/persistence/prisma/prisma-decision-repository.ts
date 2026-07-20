import { prisma } from "../../db/client";
import type { DecisionStatus } from "../../intelligence/decision/types";
import type { DecisionRepository } from "../repositories";
import type { SaveDecisionInput, SavedDecisionRecord } from "../types";
import type { PrismaClientOrTransaction } from "./client";
import { toDecisionRecordDomain, toInputJson, toNullableInputJson } from "./mappers";

/**
 * Defaults to the app's shared Prisma singleton (server/db/client.ts). Tests
 * inject a PrismaClient pointed at an isolated database instead — see
 * server/persistence/__tests__/test-db.ts. The orchestration layer instead
 * binds this to one leg of an interactive transaction — see
 * ./prisma-transaction-runner.ts.
 */
export class PrismaDecisionRepository implements DecisionRepository {
  constructor(private readonly db: PrismaClientOrTransaction = prisma) {}

  async save(input: SaveDecisionInput): Promise<SavedDecisionRecord> {
    const { decision } = input;

    const row = await this.db.decisionRecord.create({
      data: {
        businessId: input.businessId,
        conversationId: decision.metadata.conversationId,
        conversationSnapshotId: input.conversationSnapshotId,
        engineDecisionId: decision.id,
        type: decision.type,
        title: decision.title,
        recommendation: decision.recommendation,
        objective: decision.objective,
        reasoning: decision.reasoning,
        evidence: toInputJson(decision.evidence),
        assumptions: decision.assumptions,
        missingInformation: toInputJson(decision.missingInformation),
        alternatives: toInputJson(decision.alternatives),
        confidence: decision.confidence,
        riskLevel: decision.riskLevel,
        impactLevel: decision.impactLevel,
        approvalRequirement: decision.approvalRequirement,
        suggestedAction: toInputJson(decision.suggestedAction),
        customerProfile: toNullableInputJson(decision.customerProfile),
        warnings: toInputJson(decision.warnings),
        status: decision.status,
        engineSchemaVersion: decision.metadata.engineSchemaVersion,
        promptVersion: decision.metadata.promptVersion,
        aiProvider: decision.metadata.aiProvider,
        modelName: decision.metadata.modelName,
        decidedAt: decision.metadata.decidedAt,
        sourceConversationIntelligenceGeneratedAt: decision.metadata.sourceConversationIntelligenceGeneratedAt,
      },
    });

    return toDecisionRecordDomain(row);
  }

  async findById(id: string): Promise<SavedDecisionRecord | null> {
    const row = await this.db.decisionRecord.findUnique({ where: { id } });
    return row ? toDecisionRecordDomain(row) : null;
  }

  async listForConversation(conversationId: string): Promise<SavedDecisionRecord[]> {
    const rows = await this.db.decisionRecord.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    });

    return rows.map(toDecisionRecordDomain);
  }

  async updateStatus(id: string, status: DecisionStatus): Promise<SavedDecisionRecord> {
    const row = await this.db.decisionRecord.update({
      where: { id },
      data: { status },
    });

    return toDecisionRecordDomain(row);
  }
}
