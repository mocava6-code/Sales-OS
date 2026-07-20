// Shared transaction wrapper for every orchestration workflow. Centralizes
// the "rollback + explicit orchestration error" rule from the atomicity
// requirement so it's implemented once, not per workflow.

import type { KoriUnitOfWork, TransactionRunner } from "../persistence/unit-of-work";
import { OrchestrationError, OrchestrationTransactionError } from "./errors";

/**
 * Runs `work` inside one transaction. Deliberate OrchestrationError
 * subtypes thrown inside `work` (DecisionNotFoundError,
 * InvalidDecisionStatusTransitionError, ...) still trigger a rollback — an
 * interactive transaction always rolls back on any thrown error — but
 * propagate as themselves so callers can distinguish "this decision doesn't
 * exist" from "the transaction technically failed." Anything else
 * (a Prisma error, a network blip, a bug) is wrapped into
 * OrchestrationTransactionError so callers always have one stable type to
 * catch for "the write didn't happen, nothing was left partially written."
 */
export async function runOrchestrationTransaction<T>(
  transactionRunner: TransactionRunner,
  work: (uow: KoriUnitOfWork) => Promise<T>,
): Promise<T> {
  try {
    return await transactionRunner.runInTransaction(work);
  } catch (error) {
    if (error instanceof OrchestrationError) {
      throw error;
    }
    throw new OrchestrationTransactionError("The orchestration transaction failed and was rolled back.", error);
  }
}
