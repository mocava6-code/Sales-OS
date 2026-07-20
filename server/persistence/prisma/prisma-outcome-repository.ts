import { prisma } from "../../db/client";
import type { OutcomeRepository } from "../repositories";
import type { OutcomeRecord, RecordOutcomeInput } from "../types";
import type { PrismaClientOrTransaction } from "./client";
import { toOutcomeDomain } from "./mappers";

/**
 * Defaults to the app's shared Prisma singleton (server/db/client.ts). Tests
 * inject a PrismaClient pointed at an isolated database instead — see
 * server/persistence/__tests__/test-db.ts. The orchestration layer instead
 * binds this to one leg of an interactive transaction — see
 * ./prisma-transaction-runner.ts.
 */
export class PrismaOutcomeRepository implements OutcomeRepository {
  constructor(private readonly db: PrismaClientOrTransaction = prisma) {}

  async record(input: RecordOutcomeInput): Promise<OutcomeRecord> {
    const row = await this.db.outcome.create({
      data: {
        decisionRecordId: input.decisionRecordId,
        outcomeType: input.outcomeType,
        attribution: input.attribution,
        notes: input.notes,
        occurredAt: input.occurredAt,
      },
    });

    return toOutcomeDomain(row);
  }

  async listForDecision(decisionRecordId: string): Promise<OutcomeRecord[]> {
    const rows = await this.db.outcome.findMany({
      where: { decisionRecordId },
      orderBy: { occurredAt: "asc" },
    });

    return rows.map(toOutcomeDomain);
  }
}
