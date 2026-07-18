import type { AIProvider } from "./ai-provider";

// A small in-memory registry, not a plugin system — just a name -> AIProvider
// lookup that AIRouter reads from. Providers register themselves by name;
// later registrations for the same name win (lets a caller override a
// built-in provider in tests without touching this file).
export interface ProviderRegistry {
  register(provider: AIProvider): void;
  get(name: string): AIProvider | undefined;
}

export function createProviderRegistry(initial: AIProvider[] = []): ProviderRegistry {
  const providers = new Map<string, AIProvider>();

  for (const provider of initial) {
    providers.set(provider.name, provider);
  }

  return {
    register(provider: AIProvider) {
      providers.set(provider.name, provider);
    },
    get(name: string) {
      return providers.get(name);
    },
  };
}
