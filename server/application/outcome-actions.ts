// Kori Sales Memory v1 — application handler for the lightweight
// "Marcar resultado" action. Same five-step pattern as every other handler
// in this directory: (1) authenticate, (2) validate, (3) authorize the
// conversation belongs to this business (reusing access-control.ts's
// existing loadAuthorizedConversation — never a second, bespoke tenant
// check), (4) call the service, (5) map to a DTO.

import type { z } from "zod";
import { recordConversationOutcomeSchema } from "@/lib/validations/outcome";
import { recordConversationOutcome } from "@/server/services/outcome-service";
import { type AuthContextResolver, defaultAuthContextResolver, requireAuthenticatedUser } from "./auth";
import { loadAuthorizedConversation } from "./access-control";
import { InvalidInputError, type ApplicationResult, toApplicationResult } from "./errors";
import { toConversationOutcomeDTO, type ConversationOutcomeDTO } from "./dto";

export interface OutcomeActionDependencies {
  resolver?: AuthContextResolver;
}

function parseOrThrow<Schema extends z.ZodTypeAny>(schema: Schema, rawInput: unknown): z.infer<Schema> {
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    throw new InvalidInputError(parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}

export function recordConversationOutcomeHandler(
  rawInput: unknown,
  dependencies: OutcomeActionDependencies = {},
): Promise<ApplicationResult<ConversationOutcomeDTO>> {
  return toApplicationResult(async () => {
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    const input = parseOrThrow(recordConversationOutcomeSchema, rawInput);

    const conversation = await loadAuthorizedConversation(user, input.conversationId);

    const outcome = await recordConversationOutcome(user.businessId, conversation.id, user.id, {
      outcomeType: input.outcomeType,
      lostReason: input.lostReason,
      productSold: input.productSold,
      notes: input.notes,
    });

    return toConversationOutcomeDTO(outcome);
  });
}
