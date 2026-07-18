import type { AIProvider } from "../ai-provider";
import type { ConversationAnalysisCapability, DecisionReasoningCapability, ModelCompletionRequest, ModelCompletionResponse } from "../capabilities";

export interface MockAIProviderOptions {
  name?: string;
  modelName?: string;
  /** Raw text to return from conversationAnalysis, or a function computing it from the actual request. */
  response?: string | ((request: ModelCompletionRequest) => string);
  /** If set, conversationAnalysis.complete() throws this instead of returning a response. */
  throwError?: Error;
  /** Raw text to return from decisionReasoning, or a function computing it from the actual request. */
  decisionReasoningResponse?: string | ((request: ModelCompletionRequest) => string);
  /** If set, decisionReasoning.complete() throws this instead of returning a response. */
  decisionReasoningThrowError?: Error;
}

export interface MockAIProvider {
  provider: AIProvider;
  getCallCount(): number;
  getLastRequest(): ModelCompletionRequest | undefined;
  getDecisionReasoningCallCount(): number;
  getLastDecisionReasoningRequest(): ModelCompletionRequest | undefined;
}

export function createMockAIProvider(options: MockAIProviderOptions = {}): MockAIProvider {
  let callCount = 0;
  let lastRequest: ModelCompletionRequest | undefined;
  let decisionReasoningCallCount = 0;
  let lastDecisionReasoningRequest: ModelCompletionRequest | undefined;

  const conversationAnalysis: ConversationAnalysisCapability = {
    async complete(request: ModelCompletionRequest): Promise<ModelCompletionResponse> {
      callCount += 1;
      lastRequest = request;

      if (options.throwError) {
        throw options.throwError;
      }

      const rawText = typeof options.response === "function" ? options.response(request) : (options.response ?? "{}");

      return { rawText };
    },
  };

  const decisionReasoning: DecisionReasoningCapability = {
    async complete(request: ModelCompletionRequest): Promise<ModelCompletionResponse> {
      decisionReasoningCallCount += 1;
      lastDecisionReasoningRequest = request;

      if (options.decisionReasoningThrowError) {
        throw options.decisionReasoningThrowError;
      }

      const rawText =
        typeof options.decisionReasoningResponse === "function"
          ? options.decisionReasoningResponse(request)
          : (options.decisionReasoningResponse ?? "{}");

      return { rawText };
    },
  };

  const provider: AIProvider = {
    name: options.name ?? "mock-provider",
    modelName: options.modelName ?? "mock-model-1",
    capabilities: { conversationAnalysis, decisionReasoning },
  };

  return {
    provider,
    getCallCount: () => callCount,
    getLastRequest: () => lastRequest,
    getDecisionReasoningCallCount: () => decisionReasoningCallCount,
    getLastDecisionReasoningRequest: () => lastDecisionReasoningRequest,
  };
}
