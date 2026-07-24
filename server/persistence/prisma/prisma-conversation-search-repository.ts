import { prisma } from "../../db/client";
import type { Prisma } from "../../db/generated/client";
import type { ConversationSearchRepository } from "../repositories";
import { MAX_CONVERSATION_SEARCH_RESULTS, type ConversationListItem, type ConversationSearchFilters } from "../types";
import type { PrismaClientOrTransaction } from "./client";

/**
 * Defaults to the app's shared Prisma singleton (server/db/client.ts). Tests
 * inject a PrismaClient pointed at an isolated database instead — see
 * server/persistence/__tests__/test-db.ts. Read-only — consumed only by
 * server/observer-console/** (ARCHITECTURE.md §20); never added to
 * KoriUnitOfWork.
 *
 * This is thin, not a validation layer: the HAS_NONE + hasObservationType
 * contradiction is rejected at the application boundary
 * (server/application/observer-console-actions.ts) before this method is
 * ever called. If it somehow receives that combination anyway,
 * hasObservationType takes precedence — a defensive default, not a second
 * validation pass.
 */
export class PrismaConversationSearchRepository implements ConversationSearchRepository {
  constructor(private readonly db: PrismaClientOrTransaction = prisma) {}

  async search(
    businessId: string,
    filters: ConversationSearchFilters,
    limit: number = MAX_CONVERSATION_SEARCH_RESULTS,
  ): Promise<ConversationListItem[]> {
    const take = Math.min(limit, MAX_CONVERSATION_SEARCH_RESULTS);

    const rows = await this.db.conversation.findMany({
      where: {
        businessId,
        ...(filters.searchText
          ? {
              lead: {
                OR: [
                  { name: { contains: filters.searchText, mode: "insensitive" } },
                  { phone: { contains: filters.searchText } },
                ],
              },
            }
          : {}),
        ...(filters.occurredAfter || filters.occurredBefore
          ? {
              lastEntryAt: {
                ...(filters.occurredAfter ? { gte: filters.occurredAfter } : {}),
                ...(filters.occurredBefore ? { lte: filters.occurredBefore } : {}),
              },
            }
          : {}),
        ...this.observationPresenceFilter(filters),
      },
      include: {
        lead: { select: { name: true, phone: true } },
        _count: { select: { observations: true } },
      },
      orderBy: { lastEntryAt: "desc" },
      take,
    });

    return rows.map((row) => ({
      id: row.id,
      leadName: row.lead.name,
      leadPhone: row.lead.phone,
      status: row.status,
      lastEntryAt: row.lastEntryAt,
      observationCount: row._count.observations,
    }));
  }

  private observationPresenceFilter(filters: ConversationSearchFilters): Prisma.ConversationWhereInput {
    if (filters.hasObservationType) {
      return { observations: { some: { type: filters.hasObservationType } } };
    }
    switch (filters.observationState) {
      case "HAS_ANY":
        return { observations: { some: {} } };
      case "HAS_NONE":
        return { observations: { none: {} } };
      default:
        return {};
    }
  }
}
