// Kori End-to-End Query Execution v0 — STEP 1 (application service).
//
// question -> parseNaturalLanguageToKoriQuery() -> executeKoriQuery()
//   -> formatKoriResponse() -> AskKoriResult
//
// Pure Kori-domain orchestration — no auth, no Next.js, no HTTP. businessId
// is a plain required parameter; this function trusts its caller to have
// already resolved it from an authenticated server context (the
// application-layer handler in server/application/kori-actions.ts is that
// caller — see requireAuthenticatedUser there). Never reads businessId from
// `question` or any other untrusted input.

import { executeKoriQuery } from "./query-executor";
import { parseNaturalLanguageToKoriQuery } from "./nl-query-parser";
import { formatKoriResponse, type KoriFormattedResponse } from "./response-formatter";
import { KORI_DEFAULT_TIMEZONE } from "./date-interpretation";
import type { KoriQuerySpec } from "./query-spec";
import type { GroqClient } from "./groq-client";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";

export interface AskKoriInput {
  businessId: string;
  question: string;
  /** Defaults to America/Lima, same as parseNaturalLanguageToKoriQuery. */
  timezone?: string;
}

export interface AskKoriDeps {
  /** Defaults to createGroqClientFromEnv() inside parseNaturalLanguageToKoriQuery. Tests inject a fake client. */
  groqClient?: GroqClient;
  /** Defaults to the real Prisma singleton inside executeKoriQuery. Tests inject a test-database client. */
  db?: PrismaClientOrTransaction;
}

export interface AskKoriResult {
  question: string;
  querySpec: KoriQuerySpec;
  result: KoriFormattedResponse;
  metadata: { generatedAt: string; timezone: string };
}

/**
 * The one entry point a caller (today: the internal test route; later: the
 * real Kori chat UI) should use to go from a natural-language question all
 * the way to a formatted answer. Never executes anything beyond what
 * executeKoriQuery already guarantees (read-only, tenant-scoped, no raw
 * SQL) — this function adds no new database access of its own.
 */
export async function askKori(input: AskKoriInput, deps: AskKoriDeps = {}): Promise<AskKoriResult> {
  const now = new Date();
  const timezone = input.timezone ?? KORI_DEFAULT_TIMEZONE;

  const querySpec = await parseNaturalLanguageToKoriQuery(
    { question: input.question, now, timezone },
    { groqClient: deps.groqClient },
  );

  const rawResult = await executeKoriQuery({ businessId: input.businessId, querySpec, db: deps.db });

  const result = formatKoriResponse(querySpec, rawResult, { now, timezone });

  return {
    question: input.question,
    querySpec,
    result,
    metadata: { generatedAt: now.toISOString(), timezone },
  };
}
