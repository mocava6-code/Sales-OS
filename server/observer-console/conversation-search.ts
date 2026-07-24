// Read-model assembly service — a thin passthrough to
// ConversationSearchRepository.search plus DTO mapping. The HAS_NONE +
// hasObservationType contradiction is rejected at the application
// validation layer (server/application/observer-console-actions.ts) before
// this is ever called — this service trusts already-validated filters, the
// same way every other repository-facing function in this codebase does.

import type { ConversationSearchFilters } from "../persistence/types";
import type { ConversationListItemDTO, ObserverConsoleReadDependencies } from "./types";

export type SearchConversationsDependencies = Pick<ObserverConsoleReadDependencies, "conversationSearch">;

export async function searchConversations(
  businessId: string,
  filters: ConversationSearchFilters,
  dependencies: SearchConversationsDependencies,
  limit?: number,
): Promise<ConversationListItemDTO[]> {
  const results = await dependencies.conversationSearch.search(businessId, filters, limit);

  return results.map((result) => ({
    id: result.id,
    leadName: result.leadName,
    leadPhone: result.leadPhone,
    status: result.status,
    lastEntryAt: result.lastEntryAt.toISOString(),
    observationCount: result.observationCount,
  }));
}
