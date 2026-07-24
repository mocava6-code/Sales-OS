// Transaction-aware persistence abstraction. Prisma-free by design — the
// orchestration layer (server/orchestration/**) depends only on this file,
// never on Prisma or on ./prisma directly, so "avoid leaking Prisma-specific
// types into domain contracts" holds even where a workflow needs atomicity.

import type {
  AdvisorActionRepository,
  ConversationSnapshotRepository,
  DecisionEventRepository,
  DecisionRepository,
  DomainEventRepository,
  ObservationRepository,
  OutcomeRepository,
} from "./repositories";

/** The full set of repositories available inside one transaction. */
export interface KoriUnitOfWork {
  conversationSnapshots: ConversationSnapshotRepository;
  decisions: DecisionRepository;
  decisionEvents: DecisionEventRepository;
  advisorActions: AdvisorActionRepository;
  outcomes: OutcomeRepository;
  domainEvents: DomainEventRepository;
  observations: ObservationRepository;
}

/**
 * Runs `work` against a set of repositories that all participate in one
 * atomic transaction: if `work` throws, every write it made is rolled back
 * and the error propagates; if it resolves, every write commits together.
 */
export interface TransactionRunner {
  runInTransaction<T>(work: (uow: KoriUnitOfWork) => Promise<T>): Promise<T>;
}
