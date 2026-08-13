// Semantic Response Intelligence — Phase 4 production AI execution path.
// Same five-step pattern as kori-actions.ts/decision-actions.ts:
// (1) authenticate, (2) authorize (OWNER only), (3) validate input,
// (4) resolve the AI provider + call the domain layer, (5) map the
// result/error. businessId ALWAYS comes from the authenticated user — the
// input schema has no businessId field, so there is nothing for a caller
// to smuggle in.

import { CONVERSATION_ACTION_OVERRIDE_LABELS, runResponseActionAIBatchSchema, setConversationActionOverrideSchema } from "@/lib/validations/response-action";
import { runResponseActionAIBatch, type ResponseActionAIBatchResult } from "@/server/services/response-action-ai-batch-service";
import { setHumanConversationActionState, type SetHumanConversationActionStateReasonCode } from "@/server/services/conversation-action-state-service";
import type { ActionState } from "@/server/intelligence/response-action/types";
import { type AuthContextResolver, type AuthenticatedUser, defaultAuthContextResolver, requireAuthenticatedUser } from "./auth";
import { tryGetAIProvider } from "./composition-root";
import { ForbiddenError, InvalidInputError, NotFoundError, type ApplicationResult, toApplicationResult } from "./errors";

/**
 * AI-assisted response-action classification touches every conversation in
 * the business and (with persist=true) writes durable state read by every
 * advisor's Today view — OWNER-only, same gating as Knowledge ingestion
 * and Observer Console.
 */
function assertResponseActionAIBatchAccess(user: AuthenticatedUser): void {
  if (user.role !== "OWNER") {
    throw new ForbiddenError("Solo el propietario del negocio puede ejecutar la clasificación asistida por IA.");
  }
}

export interface RunResponseActionAIBatchActionDependencies {
  resolver?: AuthContextResolver;
}

export function runResponseActionAIBatchHandler(
  rawInput: unknown,
  dependencies: RunResponseActionAIBatchActionDependencies = {},
): Promise<ApplicationResult<ResponseActionAIBatchResult>> {
  return toApplicationResult(async () => {
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    assertResponseActionAIBatchAccess(user);

    const parsed = runResponseActionAIBatchSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new InvalidInputError(parsed.error.flatten().fieldErrors);
    }

    // tryGetAIProvider(), not getAIProvider() — an unconfigured AI
    // provider is a valid, reportable outcome here (aiProviderConfigured:
    // false in the result), not a thrown PROVIDER_UNAVAILABLE error; the
    // caller (an OWNER checking on this maintenance tool) needs to be able
    // to tell "nothing to do, everything's resolved" apart from
    // "AI isn't wired up yet" without the request failing either way.
    return runResponseActionAIBatch({
      businessId: user.businessId,
      batchSize: parsed.data.batchSize,
      persist: parsed.data.persist,
      aiProvider: tryGetAIProvider(),
    });
  });
}

// Phase 7 — human override. The one place a label an advisor recognizes
// ("Requiere respuesta" / "Necesita seguimiento" / "Esperando al cliente" /
// "No requiere acción") maps onto the domain layer's (actionState,
// reasonCode) pair, so the two can never be submitted mismatched. No
// OWNER gate — any authenticated advisor working a conversation may mark
// its state; setHumanConversationActionState itself enforces the tenant
// boundary (a conversationId outside the caller's businessId resolves to
// "not found", never leaks or silently succeeds cross-tenant).
const OVERRIDE_LABEL_TO_STATE: Record<(typeof CONVERSATION_ACTION_OVERRIDE_LABELS)[number], { actionState: ActionState; reasonCode: SetHumanConversationActionStateReasonCode }> = {
  REQUIERE_RESPUESTA: { actionState: "REPLY_REQUIRED", reasonCode: "MARKED_REPLY_REQUIRED" },
  NECESITA_SEGUIMIENTO: { actionState: "FOLLOW_UP_REQUIRED", reasonCode: "MARKED_FOLLOW_UP_REQUIRED" },
  ESPERANDO_CLIENTE: { actionState: "WAITING_ON_CUSTOMER", reasonCode: "MARKED_ALREADY_ANSWERED" },
  NO_REQUIERE_ACCION: { actionState: "NO_ACTION_REQUIRED", reasonCode: "MARKED_NO_ACTION_REQUIRED" },
};

export interface SetConversationActionOverrideActionDependencies {
  resolver?: AuthContextResolver;
}

export function setConversationActionOverrideHandler(
  rawInput: unknown,
  dependencies: SetConversationActionOverrideActionDependencies = {},
): Promise<ApplicationResult<{ conversationId: string; actionState: ActionState }>> {
  return toApplicationResult(async () => {
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);

    const parsed = setConversationActionOverrideSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new InvalidInputError(parsed.error.flatten().fieldErrors);
    }

    const mapping = OVERRIDE_LABEL_TO_STATE[parsed.data.label];
    try {
      await setHumanConversationActionState(user.businessId, parsed.data.conversationId, mapping.actionState, mapping.reasonCode, user.id);
    } catch (error) {
      // setHumanConversationActionState throws a plain Error for "not
      // found or not this tenant's conversation" (server/services/
      // conversation-action-state-service.ts) — the service layer
      // deliberately has no dependency on this application layer's error
      // types, so the mapping happens here instead.
      if (error instanceof Error && error.message === "Conversation not found.") {
        throw new NotFoundError("la conversación");
      }
      throw error;
    }

    return { conversationId: parsed.data.conversationId, actionState: mapping.actionState };
  });
}
