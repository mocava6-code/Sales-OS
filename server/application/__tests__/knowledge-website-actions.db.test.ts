// Gated: proves startWebsiteSyncHandler/processSyncBatchHandler's OWNER
// gating and tenant scoping against sales_os_test — the crawler/pipeline
// mechanics themselves are already proven in
// server/knowledge/website/__tests__/sync-service.db.test.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAIProvider } from "@/server/intelligence/testing/mock-ai-provider";
import {
  cleanupKnowledgeTestFixture,
  createKnowledgeTestFixture,
  getTestPrisma,
  shouldRunDbTests,
  type KnowledgeTestFixture,
} from "@/server/knowledge/__tests__/test-db";
import { createFakeAuthContextResolver } from "../testing/fake-auth";
import { processSyncBatchHandler, startWebsiteSyncHandler } from "../knowledge-actions";

function fakeResponse(body: string, ok = true): Response {
  return { ok, status: ok ? 200 : 404, text: async () => body, headers: { get: () => "text/html" } } as unknown as Response;
}
function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    return routes[url] ? routes[url]() : fakeResponse("", false);
  }) as typeof fetch;
}

describe.skipIf(!shouldRunDbTests)("knowledge website actions — real pipeline against sales_os_test (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: KnowledgeTestFixture;

  beforeEach(async () => {
    fixture = await createKnowledgeTestFixture(db!, "knowledge-website-actions-db");
  });

  afterEach(async () => {
    await cleanupKnowledgeTestFixture(db!, fixture);
  });

  it("rejects a SALESPERSON from starting a website sync", async () => {
    const resolver = createFakeAuthContextResolver({ id: fixture.userId, businessId: fixture.businessId, role: "SALESPERSON" });
    const result = await startWebsiteSyncHandler(
      { rootUrl: "https://koriakiimport.com/" },
      { resolver, db: db!, fetchFn: fakeFetch({}) },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("FORBIDDEN");
  });

  it("OWNER can start a sync and process it to completion via the handler pair", async () => {
    const resolver = createFakeAuthContextResolver({ id: fixture.ownerUserId, businessId: fixture.businessId, role: "OWNER" });
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("", false),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse("", false),
      "https://koriakiimport.com/": () => fakeResponse(`<html><body><main><h1>Kit</h1><p>Compatible con Hilux.</p></main></body></html>`),
    });

    const started = await startWebsiteSyncHandler({ rootUrl: "https://koriakiimport.com/" }, { resolver, db: db!, fetchFn });
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error("unreachable");

    const mock = createMockAIProvider({ knowledgeExtractionResponse: '{"candidates":[]}' });
    const processed = await processSyncBatchHandler(
      { sourceId: started.data.sourceId },
      { resolver, db: db!, fetchFn, aiProvider: mock.provider },
    );
    expect(processed.ok).toBe(true);
    if (!processed.ok) throw new Error("unreachable");
    expect(processed.data.sourceStatus).toBe("COMPLETED");
  });

  it("rejects processing a source that belongs to a different business", async () => {
    const otherFixture = await createKnowledgeTestFixture(db!, "knowledge-website-actions-db-other");
    try {
      const ownerResolver = createFakeAuthContextResolver({ id: fixture.ownerUserId, businessId: fixture.businessId, role: "OWNER" });
      const started = await startWebsiteSyncHandler(
        { rootUrl: "https://koriakiimport.com/" },
        { resolver: ownerResolver, db: db!, fetchFn: fakeFetch({}) },
      );
      if (!started.ok) throw new Error("unreachable");

      const otherOwnerResolver = createFakeAuthContextResolver({ id: otherFixture.ownerUserId, businessId: otherFixture.businessId, role: "OWNER" });
      const mock = createMockAIProvider();
      const result = await processSyncBatchHandler(
        { sourceId: started.data.sourceId },
        { resolver: otherOwnerResolver, db: db!, aiProvider: mock.provider },
      );

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.code).toBe("NOT_FOUND");
    } finally {
      await cleanupKnowledgeTestFixture(db!, otherFixture);
    }
  });

  it("zero-AI mode: processSyncBatchHandler completes successfully with no aiProvider dependency supplied at all — resolves via tryGetAIProvider() against this environment's real (absent) config", async () => {
    // Guards against ever silently making a real, paid Anthropic call from
    // this suite if AI_PROVIDER/ANTHROPIC_API_KEY are ever configured in
    // .env.test.local later — this test's whole point is proving the
    // zero-AI path, not exercising the real provider.
    if (process.env.AI_PROVIDER || process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "AI_PROVIDER/ANTHROPIC_API_KEY are configured in this test environment — this test would make a real API call. " +
          "Remove them from .env.test.local, or rewrite this test to pass an explicit aiProvider/mock.",
      );
    }

    const resolver = createFakeAuthContextResolver({ id: fixture.ownerUserId, businessId: fixture.businessId, role: "OWNER" });
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("", false),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse("", false),
      "https://koriakiimport.com/": () => fakeResponse(`<html><body><main><h1>Kit</h1><p>Compatible con Hilux.</p></main></body></html>`),
    });

    const started = await startWebsiteSyncHandler({ rootUrl: "https://koriakiimport.com/" }, { resolver, db: db!, fetchFn });
    if (!started.ok) throw new Error("unreachable");

    // No `aiProvider` key at all — this exercises the exact same
    // resolveAIProvider() path the UI's server action hits, with nothing
    // mocked out.
    const processed = await processSyncBatchHandler({ sourceId: started.data.sourceId }, { resolver, db: db!, fetchFn });

    expect(processed.ok).toBe(true);
    if (!processed.ok) throw new Error("unreachable");
    expect(processed.data.sourceStatus).toBe("COMPLETED");
    expect(processed.data.failed).toBe(0);

    const source = await db!.knowledgeSource.findUniqueOrThrow({ where: { id: started.data.sourceId } });
    expect(source.status).toBe("COMPLETED");
    expect(source.errorMessage).toBeNull();
  });
});
