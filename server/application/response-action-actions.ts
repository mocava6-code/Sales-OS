// Semantic Response Intelligence — Phase 4 production AI execution path.
// Same five-step pattern as kori-actions.ts/decision-actions.ts:
// (1) authenticate, (2) authorize (OWNER only), (3) validate input,
// (4) resolve the AI provider + call the domain layer, (5) map the
// result/error. businessId ALWAYS comes from the authenticated user — the
// input schema has no businessId field, so there is nothing for a caller
// to smuggle in.

import { runResponseActionAIBatchSchema } from "@/lib/validations/response-action";
import { runResponseActionAIBatch, type ResponseActionAIBatchResult } from "@/server/services/response-action-ai-batch-service";
import { type AuthContextResolver, type AuthenticatedUser, defaultAuthContextResolver, requireAuthenticatedUser } from "./auth";
import { tryGetAIProvider } from "./composition-root";
import { ForbiddenError, InvalidInputError, type ApplicationResult, toApplicationResult } from "./errors";

/**
 * AI-assisted response-action classification touches every conversation in
 * the business and (with persist=true) writes durable state read by every
 * advisor's Today view — OWNER-only, same gating as Knowledge ingestion
 * and Observer Console.
 */
function assertResponseActionAIBatchAccess(user: AuthenticatedUser): void {
  if (user.role !== "OWNER") {
    throw new ForbiddenError("Only the business owner can run AI-assisted response classification.");
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
