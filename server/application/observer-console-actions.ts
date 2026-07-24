// Pure, Next.js-free application handlers behind the Observer Console
// server actions (server/actions/observer-console.ts) — same conventions as
// server/application/decision-actions.ts: authenticate -> authorize (OWNER
// only) -> validate -> construct dependencies -> call the read model ->
// map to DTO/errors, strictly in that order. assertObserverConsoleAccess
// runs before any DB lookup or dependency construction — a SALESPERSON's
// request never pays for a conversation lookup or a business-wide
// aggregate it was never going to be allowed to see.

import {
  getConversationTimelineSchema,
  searchConversationsSchema,
} from "@/lib/validations/observer-console";
import { buildConversationTimeline } from "@/server/observer-console/build-conversation-timeline";
import { listObservationCatalog } from "@/server/observer-console/observation-catalog";
import { searchConversations } from "@/server/observer-console/conversation-search";
import type {
  ConversationListItemDTO,
  ConversationTimelineDTO,
  ObservationCatalogDTO,
  ObserverConsoleReadDependencies,
} from "@/server/observer-console/types";
import type { z } from "zod";
import {
  type AuthorizedConversationForObserverConsole,
  assertObserverConsoleAccess,
  loadAuthorizedConversationForObserverConsole,
} from "./access-control";
import { type AuthContextResolver, type AuthenticatedUser, defaultAuthContextResolver, requireAuthenticatedUser } from "./auth";
import { getObserverConsoleReadDependencies } from "./composition-root";
import { toConversationTimelineDTO } from "./dto";
import { type ApplicationResult, InvalidInputError, toApplicationResult } from "./errors";

function parseOrThrow<Schema extends z.ZodTypeAny>(schema: Schema, rawInput: unknown): z.infer<Schema> {
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    throw new InvalidInputError(parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}

export interface ObserverConsoleActionDependencies {
  resolver?: AuthContextResolver;
  /** Defaults to loadAuthorizedConversationForObserverConsole (real Prisma lookup, tenant-scoped). */
  loadConversation?: (
    user: AuthenticatedUser,
    conversationId: string,
  ) => Promise<AuthorizedConversationForObserverConsole>;
  /** Defaults to getObserverConsoleReadDependencies() (real Prisma-backed repositories). */
  readDependencies?: ObserverConsoleReadDependencies;
}

// --- Conversation timeline ----------------------------------------------------

export function getConversationTimelineHandler(
  rawInput: unknown,
  dependencies: ObserverConsoleActionDependencies = {},
): Promise<ApplicationResult<ConversationTimelineDTO>> {
  return toApplicationResult(async () => {
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    assertObserverConsoleAccess(user);

    const input = parseOrThrow(getConversationTimelineSchema, rawInput);

    const loadConversation = dependencies.loadConversation ?? loadAuthorizedConversationForObserverConsole;
    const header = await loadConversation(user, input.conversationId);

    const readDependencies = dependencies.readDependencies ?? getObserverConsoleReadDependencies();
    const events = await buildConversationTimeline(header.id, readDependencies);

    return toConversationTimelineDTO(header, events);
  });
}

// --- Observation catalog -------------------------------------------------------

export function getObservationCatalogHandler(
  dependencies: ObserverConsoleActionDependencies = {},
): Promise<ApplicationResult<ObservationCatalogDTO>> {
  return toApplicationResult(async () => {
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    assertObserverConsoleAccess(user);

    const readDependencies = dependencies.readDependencies ?? getObserverConsoleReadDependencies();
    return listObservationCatalog(user.businessId, readDependencies);
  });
}

// --- Conversation search ---------------------------------------------------------

export function searchConversationsHandler(
  rawInput: unknown,
  dependencies: ObserverConsoleActionDependencies = {},
): Promise<ApplicationResult<ConversationListItemDTO[]>> {
  return toApplicationResult(async () => {
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    assertObserverConsoleAccess(user);

    const input = parseOrThrow(searchConversationsSchema, rawInput);

    const readDependencies = dependencies.readDependencies ?? getObserverConsoleReadDependencies();
    return searchConversations(
      user.businessId,
      {
        searchText: input.searchText,
        occurredAfter: input.occurredAfter,
        occurredBefore: input.occurredBefore,
        hasObservationType: input.hasObservationType,
        observationState: input.observationState,
      },
      readDependencies,
      input.limit,
    );
  });
}
