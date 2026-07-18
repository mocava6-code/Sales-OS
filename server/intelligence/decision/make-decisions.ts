import { InputValidationError } from "../errors";
import { runDecisionPipeline, type DecisionPipelineDependencies } from "./pipeline";
import { koriDecisionContextSchema } from "./schema";
import type { KoriDecision, KoriDecisionContext } from "./types";

export type MakeDecisionsDependencies = DecisionPipelineDependencies;

/**
 * The Decision Engine's single public entry point. Depends only on
 * AIProvider — never on a concrete provider, Prisma, or a database. Never
 * writes anything; returns one or more structured, schema-valid decisions
 * or throws a typed error from ./errors.ts or ../errors.ts.
 */
export async function makeDecisions(
  context: KoriDecisionContext,
  dependencies: MakeDecisionsDependencies,
): Promise<KoriDecision[]> {
  const parsedContext = koriDecisionContextSchema.safeParse(context);
  if (!parsedContext.success) {
    throw new InputValidationError("Invalid KoriDecisionContext.", parsedContext.error.issues);
  }

  return runDecisionPipeline(context, dependencies);
}
