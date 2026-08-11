// Kori Natural Language Parsing v0 — STEP 1 (Groq provider).
//
// A small, focused Groq client for exactly one job: send a system+user
// prompt, get raw text back. Deliberately NOT built on
// server/intelligence/ai-provider.ts's capability-based AIProvider
// abstraction — that interface is shaped around the Conversation
// Intelligence Engine's multi-capability vendor routing
// (conversationAnalysis/decisionReasoning/knowledgeExtraction/...), and
// bending it to fit "classify a question into KoriQuerySpec JSON" would
// couple Kori to unrelated analysis behavior for no benefit. This module
// knows nothing about KoriQuerySpec — that lives in nl-query-parser.ts.
//
// Reads GROQ_API_KEY / KORI_GROQ_MODEL directly from process.env. Never
// read a NEXT_PUBLIC_* variable here — this module must never end up
// reachable from client code.
//
// No groq-sdk (or any) dependency added: Groq's API is OpenAI-compatible
// chat completions over plain HTTP, and this project has no existing Groq
// SDK dependency (checked package.json) — a bare `fetch` call keeps this
// adapter small and dependency-free, same spirit as the Anthropic
// adapter's narrow surface (server/intelligence/providers/anthropic-ai-provider.ts).

import { KoriAIConfigurationError, KoriNaturalLanguageParseError, KoriProviderRateLimitedError } from "./errors";

const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MAX_TOKENS = 1024;
// Deterministic classification, not creative writing — no randomness needed.
const GENERATION_TEMPERATURE = 0;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ERROR_BODY_LENGTH = 2000;

export interface GroqJsonSchema {
  name: string;
  schema: Record<string, unknown>;
}

export interface GroqCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  /**
   * When set, requests Groq's strict json_schema structured-output mode
   * instead of plain JSON mode. Only pass this for a model known to
   * support it — see KORI_GROQ_STRUCTURED_OUTPUT_MODE in nl-query-parser.ts.
   */
  jsonSchema?: GroqJsonSchema;
}

export type GroqSendMessage = (request: GroqCompletionRequest) => Promise<string>;

export interface GroqClient {
  readonly model: string;
  complete(request: GroqCompletionRequest): Promise<string>;
}

export interface GroqClientConfig {
  /** Required unless `sendMessage` is injected (e.g. in tests). Never hardcode this. */
  apiKey?: string;
  model: string;
  maxTokens?: number;
  /**
   * Injection seam: bypasses the real HTTP call entirely and returns raw
   * model text directly. Tests use this so they never need a real API key
   * and never need to know Groq's response JSON shape.
   */
  sendMessage?: GroqSendMessage;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/** Builds a GroqClient from GROQ_API_KEY / KORI_GROQ_MODEL. Throws KoriAIConfigurationError if either is missing. */
export function createGroqClientFromEnv(): GroqClient {
  const apiKey = readEnv("GROQ_API_KEY");
  const model = readEnv("KORI_GROQ_MODEL");

  if (!apiKey) {
    throw new KoriAIConfigurationError("GROQ_API_KEY is not configured.");
  }
  if (!model) {
    throw new KoriAIConfigurationError("KORI_GROQ_MODEL is not configured.");
  }

  return createGroqClient({ apiKey, model });
}

export function createGroqClient(config: GroqClientConfig): GroqClient {
  const sendMessage = config.sendMessage ?? createRealSendMessage(config);
  return {
    model: config.model,
    complete: sendMessage,
  };
}

function createRealSendMessage(config: GroqClientConfig): GroqSendMessage {
  if (!config.apiKey) {
    throw new KoriAIConfigurationError("GroqClientConfig.apiKey is required when no sendMessage override is injected.");
  }
  const apiKey = config.apiKey;
  const model = config.model;
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;

  return async ({ systemPrompt, userPrompt, jsonSchema }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: GENERATION_TEMPERATURE,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: jsonSchema
            ? { type: "json_schema", json_schema: { name: jsonSchema.name, schema: jsonSchema.schema, strict: true } }
            : { type: "json_object" },
        }),
        signal: controller.signal,
      });
    } catch (cause) {
      const reason = cause instanceof Error && cause.name === "AbortError" ? "timed out" : "request failed";
      throw new KoriNaturalLanguageParseError(`Groq request ${reason}.`, cause);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      // Groq's error body only ever describes what's wrong with the request
      // (invalid model, malformed schema, etc.) — never a secret — so it's
      // safe to carry as `cause` for diagnostics. Truncated defensively;
      // never includes the Authorization header or apiKey.
      const sanitizedBody = bodyText.slice(0, MAX_ERROR_BODY_LENGTH);
      // 429 (rate limiting, e.g. the free-tier TPM cap) is not a
      // request/response-shape problem and says nothing about the
      // question's validity — kept as its own error type so callers can
      // tell "Groq is throttling us" apart from both a real parse failure
      // and "this question isn't supported."
      if (response.status === 429) {
        throw new KoriProviderRateLimitedError("Groq rate limit exceeded (429).", sanitizedBody || undefined);
      }
      throw new KoriNaturalLanguageParseError(`Groq request failed with status ${response.status}.`, sanitizedBody || undefined);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new KoriNaturalLanguageParseError("Groq response was not valid JSON.", cause);
    }

    const text = extractMessageText(body);
    if (text === null) {
      throw new KoriNaturalLanguageParseError("Groq response did not contain a completion message.");
    }
    return text;
  };
}

/** Narrow, defensive extraction of `choices[0].message.content` — Groq's response body is untyped `unknown` at this boundary. */
function extractMessageText(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const choices = (body as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const message = (first as Record<string, unknown>).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" ? content : null;
}
