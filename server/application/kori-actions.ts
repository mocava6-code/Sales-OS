// Kori End-to-End Query Execution v0 — application handler for askKori.
// Same five-step pattern as decision-actions.ts: (1) authenticate, (2)
// validate input, (3) resolve dependencies, (4) call the domain function,
// (5) map the result/error. businessId ALWAYS comes from the authenticated
// user resolved in step 1 — askKoriQuestionSchema (step 2) has no
// businessId field at all, so there is nothing for a caller to smuggle in
// via raw input even if they tried.
//
// Kori Commercial Intelligence V2 — Fase C adds one routing step before the
// existing operational pipeline: a bounded strategic-intent classification
// (server/kori/strategic-intent-classifier.ts). When it recognizes one of
// Kori's three known strategic questions, the answer comes from
// server/services/kori-strategic-answer-service.ts instead of askKori — the
// operational pipeline (askKori itself) is untouched, never called for a
// strategic question, and behaves exactly as it always has for everything
// else. classifyStrategicIntent never throws, so any failure there simply
// falls through to askKori below, same as before Fase C existed.

import type { z } from "zod";
import { askKoriQuestionSchema } from "@/lib/validations/kori";
import { askKori, type AskKoriDeps, type AskKoriResult } from "../kori/ask-kori";
import { classifyStrategicIntent, type ClassifyStrategicIntentDeps, type StrategicIntent } from "../kori/strategic-intent-classifier";
import { KORI_DEFAULT_TIMEZONE } from "../kori/date-interpretation";
import { answerStrategicQuestion } from "../services/kori-strategic-answer-service";
import { type AuthContextResolver, defaultAuthContextResolver, requireAuthenticatedUser } from "./auth";
import { InvalidInputError, type ApplicationResult, toApplicationResult } from "./errors";

export interface AskKoriActionDependencies {
  resolver?: AuthContextResolver;
  askKoriDeps?: AskKoriDeps;
  strategicIntentDeps?: ClassifyStrategicIntentDeps;
}

export interface AskKoriStrategicResult {
  kind: "strategic";
  question: string;
  intent: StrategicIntent;
  result: { answer: string };
  metadata: { generatedAt: string; timezone: string };
}

export type AskKoriHandlerResult = ({ kind: "operational" } & AskKoriResult) | AskKoriStrategicResult;

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
): Promise<ApplicationResult<AskKoriHandlerResult>> {
  return toApplicationResult(async () => {
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    const input = parseOrThrow(askKoriQuestionSchema, rawInput);

    const intent = await classifyStrategicIntent(input.question, dependencies.strategicIntentDeps);
    if (intent) {
      const now = new Date();
      const answer = await answerStrategicQuestion(user.businessId, intent, now);
      return {
        kind: "strategic",
        question: input.question,
        intent,
        result: { answer },
        metadata: { generatedAt: now.toISOString(), timezone: input.timezone ?? KORI_DEFAULT_TIMEZONE },
      };
    }

    const operational = await askKori({ businessId: user.businessId, question: input.question, timezone: input.timezone }, dependencies.askKoriDeps);
    return { kind: "operational", ...operational };
  });
}
