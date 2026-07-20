import "server-only";

import { prisma } from "@/server/db/client";
import { Prisma } from "@/server/db/generated/client";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";
import { AnalysisInProgressError } from "./errors";

// A ConversationAnalysisRun row's mere existence means "a run is in
// progress for this conversation" — see the model's doc comment in
// server/db/schema.prisma. Its unique constraint on conversationId is the
// idempotency mechanism: a second concurrent request's insert hits that
// constraint and is turned into AnalysisInProgressError before it ever
// calls the engines. No job queue, no new persisted history — this is
// disposable coordination state, deleted as soon as the run finishes
// (success or failure).
const STALE_RUN_THRESHOLD_MS = 2 * 60 * 1000;

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Defaults to the app's shared Prisma singleton. Accepting one explicitly
 * (same pattern as every Prisma*Repository) is what lets the gated DB test
 * suite exercise this real function — including its unique-constraint race
 * — against sales_os_test only, never whatever DATABASE_URL happens to be set.
 */
export async function withAnalysisRunLock<T>(
  businessId: string,
  conversationId: string,
  work: () => Promise<T>,
  db: PrismaClientOrTransaction = prisma,
): Promise<T> {
  // Self-healing: reclaim a lock orphaned by a crashed previous attempt
  // (e.g. a process restart mid-analysis) before trying to acquire one.
  // Deliberately not a cron/job queue — just a check on the same code path.
  await db.conversationAnalysisRun.deleteMany({
    where: { conversationId, startedAt: { lt: new Date(Date.now() - STALE_RUN_THRESHOLD_MS) } },
  });

  let run: { id: string };
  try {
    run = await db.conversationAnalysisRun.create({ data: { businessId, conversationId } });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new AnalysisInProgressError();
    }
    throw error;
  }

  try {
    return await work();
  } finally {
    await db.conversationAnalysisRun.delete({ where: { id: run.id } }).catch(() => {
      // Best-effort cleanup — if this fails, the stale-reclaim check above
      // recovers on the next attempt instead of blocking this one's result.
    });
  }
}
