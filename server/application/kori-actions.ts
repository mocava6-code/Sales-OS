// Kori End-to-End Query Execution v0 — application handler for askKori.
// Same five-step pattern as decision-actions.ts: (1) authenticate, (2)
// validate input, (3) resolve dependencies, (4) call the domain function,
// (5) map the result/error. businessId ALWAYS comes from the authenticated
// user resolved in step 1 — askKoriQuestionSchema (step 2) has no
// businessId field at all, so there is nothing for a caller to smuggle in
// via raw input even if they tried.

import type { z } from "zod";
import { askKoriQuestionSchema } from "@/lib/validations/kori";
import { askKori, type AskKoriDeps, type AskKoriResult } from "../kori/ask-kori";
import { type AuthContextResolver, defaultAuthContextResolver, requireAuthenticatedUser } from "./auth";
import { InvalidInputError, type ApplicationResult, toApplicationResult } from "./errors";

export interface AskKoriActionDependencies {
  resolver?: AuthContextResolver;
  askKoriDeps?: AskKoriDeps;
}

function parseOrThrow<Schema extends z.ZodTypeAny>(schema: Schema, rawInput: unknown): z.infer<Schema> {
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    throw new InvalidInputError(parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}

export function askKoriHandler(
  rawInput: unknown,
  dependencies: AskKoriActionDependencies = {},
): Promise<ApplicationResult<AskKoriResult>> {
  return toApplicationResult(async () => {
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    const input = parseOrThrow(askKoriQuestionSchema, rawInput);

    return askKori({ businessId: user.businessId, question: input.question, timezone: input.timezone }, dependencies.askKoriDeps);
  });
}
