import "server-only";

import type { AIProvider } from "@/server/intelligence/ai-provider";
import { createAIRouterFromEnv } from "@/server/intelligence/provider-factory";
import type { ObserverConsoleReadDependencies } from "@/server/observer-console/types";
import { PrismaConversationEntryRepository } from "@/server/persistence/prisma/prisma-conversation-entry-repository";
import { PrismaConversationSearchRepository } from "@/server/persistence/prisma/prisma-conversation-search-repository";
import { PrismaDomainEventRepository } from "@/server/persistence/prisma/prisma-domain-event-repository";
import { PrismaObservationRepository } from "@/server/persistence/prisma/prisma-observation-repository";
import { PrismaTransactionRunner } from "@/server/persistence/prisma/prisma-transaction-runner";
import type { TransactionRunner } from "@/server/persistence/unit-of-work";

/**
 * Everything an orchestration workflow needs, bundled once. Repositories
 * are not exposed here as a separate piece: PrismaTransactionRunner already
 * constructs them internally, scoped to its transaction — nothing above
 * that boundary should touch them directly (see Phase D / Commercial
 * Orchestration v1 reports).
 */
export interface KoriApplicationDependencies {
  aiProvider: AIProvider;
  transactionRunner: TransactionRunner;
}

let cachedTransactionRunner: TransactionRunner | undefined;
let cachedAIProvider: AIProvider | undefined;

/**
 * The single composition root every server action gets its orchestration
 * dependencies from — nothing rebuilds this wiring independently. Each
 * piece is lazy and cached *independently*: an action that never touches
 * the AI provider (approve/reject/execute/override/outcomes) never
 * constructs — or validates the env for — one, even though
 * getKoriApplicationDependencies() below bundles both for the one action
 * that needs both (analyze).
 */
export function getTransactionRunner(): TransactionRunner {
  if (!cachedTransactionRunner) {
    cachedTransactionRunner = new PrismaTransactionRunner();
  }
  return cachedTransactionRunner;
}

export function getAIProvider(): AIProvider {
  if (!cachedAIProvider) {
    cachedAIProvider = createAIRouterFromEnv().getProvider();
  }
  return cachedAIProvider;
}

export function getKoriApplicationDependencies(): KoriApplicationDependencies {
  return { aiProvider: getAIProvider(), transactionRunner: getTransactionRunner() };
}

let cachedObserverConsoleReadDependencies: ObserverConsoleReadDependencies | undefined;

/**
 * The only place server/observer-console/**'s four read-only repositories
 * are bound to real Prisma (ARCHITECTURE.md §20) — that module itself never
 * imports a concrete Prisma*Repository (enforced by
 * server/observer-console/__tests__/read-only-guardrail.test.ts). Cached
 * once, same pattern as getTransactionRunner()/getAIProvider() above; all
 * four repositories default to the app's shared Prisma singleton, same as
 * every other Prisma*Repository.
 */
export function getObserverConsoleReadDependencies(): ObserverConsoleReadDependencies {
  if (!cachedObserverConsoleReadDependencies) {
    cachedObserverConsoleReadDependencies = {
      domainEvents: new PrismaDomainEventRepository(),
      observations: new PrismaObservationRepository(),
      conversationEntries: new PrismaConversationEntryRepository(),
      conversationSearch: new PrismaConversationSearchRepository(),
    };
  }
  return cachedObserverConsoleReadDependencies;
}
