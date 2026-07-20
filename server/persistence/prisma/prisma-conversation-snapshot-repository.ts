import { prisma } from "../../db/client";
import type { ConversationSnapshotRepository } from "../repositories";
import type { SaveConversationSnapshotInput, SavedConversationSnapshot } from "../types";
import type { PrismaClientOrTransaction } from "./client";
import { toConversationSnapshotDomain, toInputJson, toNullableInputJson } from "./mappers";

/**
 * Defaults to the app's shared Prisma singleton (server/db/client.ts). Tests
 * inject a PrismaClient pointed at an isolated database instead — see
 * server/persistence/__tests__/test-db.ts. The orchestration layer instead
 * binds this to one leg of an interactive transaction — see
 * ./prisma-transaction-runner.ts.
 */
export class PrismaConversationSnapshotRepository implements ConversationSnapshotRepository {
  constructor(private readonly db: PrismaClientOrTransaction = prisma) {}

  async save(input: SaveConversationSnapshotInput): Promise<SavedConversationSnapshot> {
    const row = await this.db.conversationSnapshot.create({
      data: {
        businessId: input.businessId,
        conversationId: input.conversationId,
        customerIdentification: toInputJson(input.result.customerIdentification),
        facts: toInputJson(input.result.facts),
        inferences: toInputJson(input.result.inferences),
        objections: toInputJson(input.result.objections),
        missingInformation: toInputJson(input.result.missingInformation),
        warnings: toInputJson(input.result.warnings),
        draftResponse: toNullableInputJson(input.result.draftResponse),
        overallConfidence: input.result.overallConfidence,
        engineSchemaVersion: input.result.metadata.engineSchemaVersion,
        promptVersion: input.result.metadata.promptVersion,
        aiProvider: input.result.metadata.modelProvider,
        modelName: input.result.metadata.modelName,
        analyzedAt: input.result.metadata.analyzedAt,
      },
    });

    return toConversationSnapshotDomain(row);
  }

  async findLatestForConversation(conversationId: string): Promise<SavedConversationSnapshot | null> {
    const row = await this.db.conversationSnapshot.findFirst({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
    });

    return row ? toConversationSnapshotDomain(row) : null;
  }

  async listForConversation(conversationId: string): Promise<SavedConversationSnapshot[]> {
    const rows = await this.db.conversationSnapshot.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    });

    return rows.map(toConversationSnapshotDomain);
  }
}
