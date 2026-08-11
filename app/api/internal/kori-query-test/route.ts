import { NextResponse, type NextRequest } from "next/server";
import { askKoriHandler } from "@/server/application/kori-actions";
import type { ApplicationErrorCode } from "@/server/application/errors";

// Kori End-to-End Query Execution v0 — STEP 3. INTERNAL/temporary test
// route, not the final production UI/API. Auth-gated via askKoriHandler's
// own requireAuthenticatedUser() call (server/application/auth.ts) — this
// route does no auth logic of its own, it only translates
// askKoriHandler's ApplicationResult into an HTTP response.
//
// businessId is NEVER read from the query string — this route only ever
// reads `q`. Even a request like ?q=...&businessId=other-biz has that
// second param silently ignored: askKoriQuestionSchema (lib/validations/
// kori.ts) has no businessId field, and askKoriHandler resolves businessId
// exclusively from the authenticated user.
//
// Every error path goes through toApplicationError (server/application/
// errors.ts), which only ever returns pre-crafted safe messages — no Groq
// response body, no Prisma/SQL detail, no secret, no stack trace ever
// reaches this route's JSON output.

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

export async function GET(request: NextRequest) {
  const question = request.nextUrl.searchParams.get("q");

  const result = await askKoriHandler({ question });

  if (result.ok) {
    return NextResponse.json(result.data);
  }

  const status = ERROR_CODE_TO_STATUS[result.error.code];
  return NextResponse.json({ error: result.error }, { status });
}
