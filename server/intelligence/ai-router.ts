import type { AIProvider } from "./ai-provider";
import type { ProviderRegistry } from "./provider-registry";

/**
 * Routes requests to an AIProvider. Today this simply returns the one
 * configured provider — no task-based routing yet. The seam exists so
 * future routing (e.g. "conversation extraction -> OpenAI, complex
 * reasoning -> Anthropic, fast classification -> Groq, vision -> Gemini,
 * local inference -> Ollama") can be added by extending `getProvider` with
 * an optional task hint later, without changing anything upstream of
 * AIRouter — callers already only depend on this interface, never on a
 * concrete provider.
 */
export interface AIRouter {
  getProvider(): AIProvider;
}

export function createAIRouter(registry: ProviderRegistry, config: { selectedProvider: string }): AIRouter {
  return {
    getProvider(): AIProvider {
      const provider = registry.get(config.selectedProvider);
      if (!provider) {
        throw new Error(
          `AI provider "${config.selectedProvider}" is not registered. Check AI_PROVIDER and the provider registry setup.`,
        );
      }
      return provider;
    },
  };
}
