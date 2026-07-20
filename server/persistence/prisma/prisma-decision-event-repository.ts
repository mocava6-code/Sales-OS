import { prisma } from "../../db/client";
import type { DecisionEventRepository } from "../repositories";
import type { AppendDecisionEventInput, DecisionEventRecord } from "../types";
import type { PrismaClientOrTransaction } from "./client";
import { toDecisionEventDomain } from "./mappers";

/**
 * Defaults to the app's shared Prisma singleton (server/db/client.ts). Tests
 * inject a PrismaClient pointed at an isolated database instead — see
 * server/persistence/__tests__/test-db.ts. The orchestration layer instead
 * binds this to one leg of an interactive transaction — see
 * ./prisma-transaction-runner.ts.
 */
export class PrismaDecisionEventRepository implements DecisionEventRepository {
  constructor(private readonly db: PrismaClientOrTransaction = prisma) {}

  async append(input: AppendDecisionEventInput): Promise<DecisionEventRecord> {
    const row = await this.db.decisionEvent.create({
      data: {
        decisionRecordId: input.decisionRecordId,
        eventType: input.eventType,
        occurredAt: input.occurredAt,
        note: input.note,
      },
    });

    return toDecisionEventDomain(row);
  }

  async listForDecision(decisionRecordId: string): Promise<DecisionEventRecord[]> {
    const rows = await this.db.decisionEvent.findMany({
      where: { decisionRecordId },
      orderBy: { occurredAt: "asc" },
    });

    return rows.map(toDecisionEventDomain);
  }
}
