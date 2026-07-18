import { InputValidationError } from "./errors";
import { runConversationIntelligencePipeline, type PipelineDependencies } from "./pipeline";
import { conversationIntelligenceInputSchema } from "./schema";
import type { ConversationIntelligenceInput, ConversationIntelligenceResult } from "./types";

export type AnalyzeConversationDependencies = PipelineDependencies;

/**
 * The engine's single public entry point. Depends only on interfaces
 * (AIProvider, ChannelAdapter, KnowledgeSource) — never on a concrete
 * provider or a database. Never writes anything; returns one structured,
 * schema-valid result or throws a typed error from ./errors.
 */
export async function analyzeConversation(
  input: ConversationIntelligenceInput,
  dependencies: AnalyzeConversationDependencies,
): Promise<ConversationIntelligenceResult> {
  // 1. Input validation
  const parsedInput = conversationIntelligenceInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new InputValidationError("Invalid ConversationIntelligenceInput.", parsedInput.error.issues);
  }

  return runConversationIntelligencePipeline(parsedInput.data, dependencies);
}
