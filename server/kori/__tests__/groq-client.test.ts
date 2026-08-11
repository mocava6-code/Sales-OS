import { afterEach, describe, expect, it, vi } from "vitest";
import { KoriAIConfigurationError, KoriNaturalLanguageParseError } from "../errors";
import { createGroqClient, createGroqClientFromEnv } from "../groq-client";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe("createGroqClientFromEnv", () => {
  it("throws KoriAIConfigurationError when GROQ_API_KEY is missing", () => {
    delete process.env.GROQ_API_KEY;
    process.env.KORI_GROQ_MODEL = "test-model";

    expect(() => createGroqClientFromEnv()).toThrow(KoriAIConfigurationError);
    expect(() => createGroqClientFromEnv()).toThrow(/GROQ_API_KEY/);
  });

  it("throws KoriAIConfigurationError when KORI_GROQ_MODEL is missing — no default model is assumed", () => {
    process.env.GROQ_API_KEY = "test-key";
    delete process.env.KORI_GROQ_MODEL;

    expect(() => createGroqClientFromEnv()).toThrow(KoriAIConfigurationError);
    expect(() => createGroqClientFromEnv()).toThrow(/KORI_GROQ_MODEL/);
  });

  it("builds a client from env when both vars are set", () => {
    process.env.GROQ_API_KEY = "test-key";
    process.env.KORI_GROQ_MODEL = "test-model";

    const client = createGroqClientFromEnv();
    expect(client.model).toBe("test-model");
  });
});

describe("createGroqClient", () => {
  it("uses an injected sendMessage without ever needing a real API key", async () => {
    const sendMessage = vi.fn().mockResolvedValue('{"operation":"COUNT_LEADS"}');
    const client = createGroqClient({ model: "test-model", sendMessage });

    const result = await client.complete({ systemPrompt: "sys", userPrompt: "user" });

    expect(result).toBe('{"operation":"COUNT_LEADS"}');
    expect(sendMessage).toHaveBeenCalledWith({ systemPrompt: "sys", userPrompt: "user" });
  });

  it("throws KoriAIConfigurationError if no apiKey and no sendMessage override are given", () => {
    expect(() => createGroqClient({ model: "test-model" })).toThrow(KoriAIConfigurationError);
  });

  it("calls the Groq chat completions endpoint with JSON mode by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"operation":"COUNT_LEADS"}' } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createGroqClient({ model: "test-model", apiKey: "test-key" });
    const result = await client.complete({ systemPrompt: "sys", userPrompt: "user" });

    expect(result).toBe('{"operation":"COUNT_LEADS"}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(requestInit.headers.authorization).toBe("Bearer test-key");
    const body = JSON.parse(requestInit.body);
    expect(body.model).toBe("test-model");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "user" },
    ]);
  });

  it("requests json_schema mode when a jsonSchema is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createGroqClient({ model: "test-model", apiKey: "test-key" });
    await client.complete({
      systemPrompt: "sys",
      userPrompt: "user",
      jsonSchema: { name: "kori_query_spec", schema: { type: "object" } },
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "kori_query_spec", schema: { type: "object" }, strict: true },
    });
  });

  it("throws KoriNaturalLanguageParseError on a non-OK HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("server error", { status: 500 })));

    const client = createGroqClient({ model: "test-model", apiKey: "test-key" });
    await expect(client.complete({ systemPrompt: "sys", userPrompt: "user" })).rejects.toThrow(KoriNaturalLanguageParseError);
  });

  it("throws KoriNaturalLanguageParseError when the response has no completion message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 })));

    const client = createGroqClient({ model: "test-model", apiKey: "test-key" });
    await expect(client.complete({ systemPrompt: "sys", userPrompt: "user" })).rejects.toThrow(KoriNaturalLanguageParseError);
  });

  it("throws KoriNaturalLanguageParseError when fetch itself rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const client = createGroqClient({ model: "test-model", apiKey: "test-key" });
    await expect(client.complete({ systemPrompt: "sys", userPrompt: "user" })).rejects.toThrow(KoriNaturalLanguageParseError);
  });
});
