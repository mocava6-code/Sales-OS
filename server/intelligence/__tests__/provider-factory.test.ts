import { afterEach, describe, expect, it } from "vitest";
import { createAIRouterFromEnv } from "../provider-factory";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("createAIRouterFromEnv", () => {
  it("throws a clear error when AI_PROVIDER is missing", () => {
    delete process.env.AI_PROVIDER;
    process.env.AI_MODEL = "test-model";

    expect(() => createAIRouterFromEnv()).toThrow(/AI_PROVIDER/);
  });

  it("throws a clear error when AI_MODEL is missing — no default model is assumed", () => {
    process.env.AI_PROVIDER = "anthropic";
    delete process.env.AI_MODEL;

    expect(() => createAIRouterFromEnv()).toThrow(/AI_MODEL/);
  });

  it("throws a clear error when the selected provider's credential is missing", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_MODEL = "test-model";
    delete process.env.ANTHROPIC_API_KEY;

    expect(() => createAIRouterFromEnv()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("throws a clear error for an unimplemented provider — never constructs an unknown vendor client", () => {
    process.env.AI_PROVIDER = "openai";
    process.env.AI_MODEL = "test-model";

    expect(() => createAIRouterFromEnv()).toThrow(/not implemented/i);
  });

  it("returns a router whose getProvider() resolves to the configured provider", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_MODEL = "test-model";
    process.env.ANTHROPIC_API_KEY = "test-key";

    const router = createAIRouterFromEnv();
    const provider = router.getProvider();

    expect(provider.name).toBe("anthropic");
    expect(provider.modelName).toBe("test-model");
    expect(provider.capabilities.conversationAnalysis).toBeDefined();
  });

  it('throws a clear error when AI_PROVIDER="groq" but GROQ_API_KEY is missing', () => {
    process.env.AI_PROVIDER = "groq";
    process.env.AI_MODEL = "test-model";
    delete process.env.GROQ_API_KEY;

    expect(() => createAIRouterFromEnv()).toThrow(/GROQ_API_KEY/);
  });

  it('AI_PROVIDER="groq" reuses GROQ_API_KEY (Kori\'s existing secret) and AI_MODEL (not KORI_GROQ_MODEL)', () => {
    process.env.AI_PROVIDER = "groq";
    process.env.AI_MODEL = "llama-test-model";
    process.env.GROQ_API_KEY = "test-groq-key";
    delete process.env.KORI_GROQ_MODEL;

    const router = createAIRouterFromEnv();
    const provider = router.getProvider();

    expect(provider.name).toBe("groq");
    expect(provider.modelName).toBe("llama-test-model");
    expect(provider.capabilities.conversationAnalysis).toBeDefined();
  });
});
