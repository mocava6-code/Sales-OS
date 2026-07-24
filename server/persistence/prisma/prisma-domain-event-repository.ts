import { prisma } from "../../db/client";
import type { DomainEventRepository } from "../repositories";
import type { SaveDomainEventInput, SavedDomainEventRecord } from "../types";
import type { PrismaClientOrTransaction } from "./client";
import { toDomainEventDomain, toInputJson } from "./mappers";

/**
 * Defaults to the app's shared Prisma singleton (server/db/client.ts). Tests
 * inject a PrismaClient pointed at an isolated database instead — see
 * server/persistence/__tests__/test-db.ts. The orchestration layer instead
 * binds this to one leg of an interactive transaction — see
 * ./prisma-transaction-runner.ts.
 */
export class PrismaDomainEventRepository implements DomainEventRepository {
  constructor(private readonly db: PrismaClientOrTransaction = prisma) {}

  async append(input: SaveDomainEventInput): Promise<SavedDomainEventRecord> {
    const row = await this.db.domainEvent.create({
      data: {
        businessId: input.businessId,
        conversationId: input.conversationId,
        conversationEntryId: input.conversationEntryId,
        eventType: input.event.type,
        payload: toInputJson(input.event),
        occurredAt: input.event.occurredAt,
      },
    });

    return toDomainEventDomain(row);
  }

  /** occurredAt asc, then id asc as a tie-break — deterministic even when two events share a timestamp. */
  async listForConversation(conversationId: string): Promise<SavedDomainEventRecord[]> {
    const rows = await this.db.domainEvent.findMany({
      where: { conversationId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    });

    return rows.map(toDomainEventDomain);
  }
}
