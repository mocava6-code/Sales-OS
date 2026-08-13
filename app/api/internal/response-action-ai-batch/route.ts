import { NextResponse, type NextRequest } from "next/server";
import { runResponseActionAIBatchHandler } from "@/server/application/response-action-actions";
import type { ApplicationErrorCode } from "@/server/application/errors";

// Semantic Response Intelligence — Phase 4 production AI execution path.
// Authenticated, OWNER-only maintenance endpoint. All auth/authorization
// logic lives in runResponseActionAIBatchHandler (server/application/
// response-action-actions.ts) — this route only translates its
// ApplicationResult into an HTTP response, same thin-route pattern as
// app/api/internal/kori-query-test/route.ts.
//
// businessId is NEVER read from the request body — the handler resolves
// it exclusively from the authenticated OWNER. Every error path goes
// through toApplicationError, which only ever returns pre-crafted safe
// messages — no Groq response body, no Prisma/SQL detail, no secret, no
// stack trace ever reaches this route's JSON output. The result body
// itself (server/services/response-action-ai-batch-service.ts) only ever
// contains structured fields (actionState/reasonCode/confidence/source)
// — never raw customer message content.
//
// POST body: { batchSize?: number (1-25, default 5), persist?: boolean
// (default false — classify only, write nothing) }.

const ERROR_CODE_TO_STATUS: Record<ApplicationErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  INVALID_TRANSITION: 409,
  MISSING_CRITICAL_INFORMATION: 422,
  ANALYSIS_IN_PROGRESS: 409,
  ORCHESTRATION_FAILURE: 500,
  PROVIDER_UNAVAILABLE: 503,
  UNSUPPORTED_QUESTION: 400,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const result = await runResponseActionAIBatchHandler(body);

  if (result.ok) {
    return NextResponse.json(result.data);
  }

  const status = ERROR_CODE_TO_STATUS[result.error.code];
  return NextResponse.json({ error: result.error }, { status });
}
