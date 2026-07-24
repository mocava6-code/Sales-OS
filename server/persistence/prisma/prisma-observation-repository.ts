import { prisma } from "../../db/client";
import type { ObservationRepository } from "../repositories";
import type { ObservationTypeAggregate, SaveObservationInput, SavedObservationRecord } from "../types";
import type { PrismaClientOrTransaction } from "./client";
import { toInputJson, toObservationDomain } from "./mappers";

/**
 * Defaults to the app's shared Prisma singleton (server/db/client.ts). Tests
 * inject a PrismaClient pointed at an isolated database instead — see
 * server/persistence/__tests__/test-db.ts. The orchestration layer instead
 * binds this to one leg of an interactive transaction — see
 * ./prisma-transaction-runner.ts.
 */
export class PrismaObservationRepository implements ObservationRepository {
  constructor(private readonly db: PrismaClientOrTransaction = prisma) {}

  async save(input: SaveObservationInput): Promise<SavedObservationRecord> {
    const row = await this.db.observation.create({
      data: {
        businessId: input.businessId,
        conversationId: input.conversationId,
        domainEventId: input.domainEventId,
        conversationEntryId: input.conversationEntryId,
        type: input.observation.type,
        summary: input.observation.summary,
        evidence: toInputJson(input.observation.evidence),
        occurredAt: input.occurredAt,
      },
    });

    return toObservationDomain(row);
  }

  /** occurredAt asc, then id asc as a tie-break — deterministic even when two observations share a timestamp. */
  async listForConversation(conversationId: string): Promise<SavedObservationRecord[]> {
    const rows = await this.db.observation.findMany({
      where: { conversationId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    });

    return rows.map(toObservationDomain);
  }

  /** Read-only aggregate for Observer Console's catalog view (ARCHITECTURE.md §20). Types with zero rows are absent, not zero-filled. */
  async aggregateByType(businessId: string): Promise<ObservationTypeAggregate[]> {
    const rows = await this.db.observation.groupBy({
      by: ["type"],
      where: { businessId },
      _count: { _all: true },
      _max: { occurredAt: true },
    });

    return rows.map((row) => ({
      type: row.type,
      count: row._count._all,
      lastSeenAt: row._max.occurredAt,
    }));
  }
}
