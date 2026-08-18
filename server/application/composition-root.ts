import "server-only";

import type { AIProvider } from "@/server/intelligence/ai-provider";
import type { KnowledgeSource } from "@/server/intelligence/knowledge-source";
import { createAIRouterFromEnv } from "@/server/intelligence/provider-factory";
import type { ObserverConsoleReadDependencies } from "@/server/observer-console/types";
import { PrismaConversationEntryRepository } from "@/server/persistence/prisma/prisma-conversation-entry-repository";
import { PrismaConversationSearchRepository } from "@/server/persistence/prisma/prisma-conversation-search-repository";
import { PrismaDomainEventRepository } from "@/server/persistence/prisma/prisma-domain-event-repository";
import { PrismaKnowledgeSource } from "@/server/persistence/prisma/prisma-knowledge-source";
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
  knowledgeSource: KnowledgeSource;
}

let cachedTransactionRunner: TransactionRunner | undefined;
let cachedAIProvider: AIProvider | undefined;
let cachedKnowledgeSource: KnowledgeSource | undefined;

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

/**
 * Knowledge-Ingestion-specific: AI is optional there (Sprint 8 zero-cost
 * mode review), unlike everywhere else in this file. Returns undefined
 * instead of throwing when AI_PROVIDER/AI_MODEL/ANTHROPIC_API_KEY aren't
 * configured — getAIProvider() itself is untouched and still hard-required
 * by the Decision Engine and Conversation Intelligence Engine, which must
 * keep failing loudly when AI is unavailable, not silently degrade.
 */
export function tryGetAIProvider(): AIProvider | undefined {
  try {
    return getAIProvider();
  } catch {
    return undefined;
  }
}

/**
 * Retrieval-only over OWNER-approved KnowledgeItem rows (see
 * PrismaKnowledgeSource's own doc comment) — always constructible, unlike
 * getAIProvider(), since it needs no env/API key and a business with zero
 * approved knowledge simply gets zero snippets back, never an error.
 */
export function getKnowledgeSource(): KnowledgeSource {
  if (!cachedKnowledgeSource) {
    cachedKnowledgeSource = new PrismaKnowledgeSource();
  }
  return cachedKnowledgeSource;
}

export function getKoriApplicationDependencies(): KoriApplicationDependencies {
  return { aiProvider: getAIProvider(), transactionRunner: getTransactionRunner(), knowledgeSource: getKnowledgeSource() };
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
