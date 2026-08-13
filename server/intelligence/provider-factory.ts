import type { AIRouter } from "./ai-router";
import { createAIRouter } from "./ai-router";
import { createProviderRegistry } from "./provider-registry";
import { createAnthropicAIProvider } from "./providers/anthropic-ai-provider";
import { createGroqAIProvider } from "./providers/groq-ai-provider";
import { createGroqClient } from "../kori/groq-client";

const DEFAULT_MAX_TOKENS = 2048;

/**
 * The only place process.env is read for the Conversation Intelligence
 * Engine's AI layer. Tests never call this — they inject an AIProvider
 * directly (createMockAIProvider, or createAnthropicAIProvider with a
 * `sendMessage` override) so credentials are never required to run them.
 *
 * Only the provider named by AI_PROVIDER is ever constructed — other vendor
 * SDKs are never touched, even if their credential env vars happen to be
 * set. Adding a new vendor means adding one case below (and one adapter
 * file under ./providers) — nothing else in the engine changes.
 */
export function createAIRouterFromEnv(): AIRouter {
  const selectedProvider = process.env.AI_PROVIDER;
  if (!selectedProvider) {
    throw new Error("AI_PROVIDER is not configured. Set it in your environment (see .env.example).");
  }

  const model = process.env.AI_MODEL;
  if (!model) {
    throw new Error("AI_MODEL is not configured. No default model is assumed — set it explicitly (see .env.example).");
  }

  const registry = createProviderRegistry();

  switch (selectedProvider) {
    case "anthropic": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY is not configured. Required when AI_PROVIDER="anthropic".');
      }
      registry.register(createAnthropicAIProvider({ apiKey, model, maxTokens: DEFAULT_MAX_TOKENS }));
      break;
    }
    case "groq": {
      // Reuses the SAME GROQ_API_KEY already configured in production for
      // Kori's NL parser — no new secret. AI_MODEL (not KORI_GROQ_MODEL)
      // is the model var here, for consistency with every other provider
      // case in this switch.
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        throw new Error('GROQ_API_KEY is not configured. Required when AI_PROVIDER="groq".');
      }
      const groqClient = createGroqClient({ apiKey, model, maxTokens: DEFAULT_MAX_TOKENS });
      registry.register(createGroqAIProvider({ groqClient }));
      break;
    }
    default:
      throw new Error(`AI_PROVIDER="${selectedProvider}" is not implemented yet. Supported providers: anthropic, groq.`);
  }

  return createAIRouter(registry, { selectedProvider });
}
