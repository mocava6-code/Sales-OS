import { prisma } from "../../db/client";
import type { AdvisorActionRepository } from "../repositories";
import type { AdvisorActionRecord, RecordAdvisorActionInput } from "../types";
import type { PrismaClientOrTransaction } from "./client";
import { toAdvisorActionDomain } from "./mappers";

/**
 * Defaults to the app's shared Prisma singleton (server/db/client.ts). Tests
 * inject a PrismaClient pointed at an isolated database instead — see
 * server/persistence/__tests__/test-db.ts. The orchestration layer instead
 * binds this to one leg of an interactive transaction — see
 * ./prisma-transaction-runner.ts.
 */
export class PrismaAdvisorActionRepository implements AdvisorActionRepository {
  constructor(private readonly db: PrismaClientOrTransaction = prisma) {}

  async record(input: RecordAdvisorActionInput): Promise<AdvisorActionRecord> {
    const row = await this.db.advisorAction.create({
      data: {
        decisionRecordId: input.decisionRecordId,
        actionType: input.actionType,
        advisorUserId: input.advisorUserId,
        notes: input.notes,
        occurredAt: input.occurredAt,
      },
    });

    return toAdvisorActionDomain(row);
  }

  async listForDecision(decisionRecordId: string): Promise<AdvisorActionRecord[]> {
    const rows = await this.db.advisorAction.findMany({
      where: { decisionRecordId },
      orderBy: { occurredAt: "asc" },
    });

    return rows.map(toAdvisorActionDomain);
  }
}
