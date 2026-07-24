"use server";

// Thin Next.js server action wrappers. All the actual logic (auth,
// authorization, validation, dependency construction, read-model call,
// error mapping) lives in server/application/observer-console-actions.ts —
// these just expose it as "use server" entry points with the real
// (non-fake) dependencies.

import {
  getObservationCatalogHandler,
  getConversationTimelineHandler,
  searchConversationsHandler,
} from "@/server/application/observer-console-actions";

export async function getConversationTimelineAction(rawInput: unknown) {
  return getConversationTimelineHandler(rawInput);
}

export async function getObservationCatalogAction() {
  return getObservationCatalogHandler();
}

export async function searchConversationsAction(rawInput: unknown) {
  return searchConversationsHandler(rawInput);
}
