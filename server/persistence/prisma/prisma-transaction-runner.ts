import { prisma } from "../../db/client";
import type { PrismaClient } from "../../db/generated/client";
import type { KoriUnitOfWork, TransactionRunner } from "../unit-of-work";
import { PrismaAdvisorActionRepository } from "./prisma-advisor-action-repository";
import { PrismaConversationSnapshotRepository } from "./prisma-conversation-snapshot-repository";
import { PrismaDecisionEventRepository } from "./prisma-decision-event-repository";
import { PrismaDecisionRepository } from "./prisma-decision-repository";
import { PrismaOutcomeRepository } from "./prisma-outcome-repository";

/**
 * The only place in the codebase that opens a Prisma interactive
 * transaction. Builds a fresh KoriUnitOfWork bound to the transaction's own
 * client for every call — repositories constructed here never leak outside
 * `work`, so nothing can accidentally write outside the transaction boundary.
 */
export class PrismaTransactionRunner implements TransactionRunner {
  constructor(private readonly db: PrismaClient = prisma) {}

  runInTransaction<T>(work: (uow: KoriUnitOfWork) => Promise<T>): Promise<T> {
    return this.db.$transaction((tx) => {
      const uow: KoriUnitOfWork = {
        conversationSnapshots: new PrismaConversationSnapshotRepository(tx),
        decisions: new PrismaDecisionRepository(tx),
        decisionEvents: new PrismaDecisionEventRepository(tx),
        advisorActions: new PrismaAdvisorActionRepository(tx),
        outcomes: new PrismaOutcomeRepository(tx),
      };
      return work(uow);
    });
  }
}
