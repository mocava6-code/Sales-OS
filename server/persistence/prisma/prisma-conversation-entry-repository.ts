import { prisma } from "../../db/client";
import type { ConversationEntryRepository } from "../repositories";
import type { ConversationEntryRecord } from "../types";
import type { PrismaClientOrTransaction } from "./client";

/**
 * Defaults to the app's shared Prisma singleton (server/db/client.ts). Tests
 * inject a PrismaClient pointed at an isolated database instead — see
 * server/persistence/__tests__/test-db.ts. Read-only — consumed only by
 * server/observer-console/** (ARCHITECTURE.md §20); never added to
 * KoriUnitOfWork.
 */
export class PrismaConversationEntryRepository implements ConversationEntryRepository {
  constructor(private readonly db: PrismaClientOrTransaction = prisma) {}

  /**
   * occurredAt asc, then id asc as a tie-break. `select` (not `include`)
   * enumerates exactly the sanitized fields — rawPayload, mediaId,
   * mediaSizeBytes, quotedExternalId, and externalId are never pulled out
   * of Postgres for this read path, not merely dropped after the fact.
   */
  async listForConversation(conversationId: string): Promise<ConversationEntryRecord[]> {
    return this.db.conversationEntry.findMany({
      where: { conversationId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        direction: true,
        content: true,
        messageType: true,
        occurredAt: true,
        mediaMimeType: true,
        mediaFilename: true,
        mediaCaption: true,
      },
    });
  }
}
