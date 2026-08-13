// Gated: proves sync-service.ts's full "discover -> bounded batch process ->
// extract -> reinforce" pipeline against sales_os_test only, with fetch and
// the AI provider both faked (no real network, no real LLM calls).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/server/db/generated/client";
import { createMockAIProvider } from "@/server/intelligence/testing/mock-ai-provider";
import { cleanupKnowledgeTestFixture, createKnowledgeTestFixture, getTestPrisma, shouldRunDbTests, type KnowledgeTestFixture } from "../../__tests__/test-db";
import { processNextSyncBatch, startWebsiteSync } from "../sync-service";

/**
 * Wraps a real PrismaClient so `db.websitePage.upsert` throws while every
 * other call (including every other websitePage/knowledgeSource method)
 * still hits the real sales_os_test database — reproduces the exact "write
 * fails after KnowledgeSource creation" shape of the Sprint 8 acceptance bug
 * deterministically, without needing to wait out a real 5s Prisma
 * transaction timeout against a slow connection.
 */
function withFailingPageUpsert(db: PrismaClient, message: string): PrismaClient {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "websitePage") {
        const real = target.websitePage;
        return new Proxy(real, {
          get(inner, innerProp) {
            if (innerProp === "upsert") {
              return async () => {
                throw new Error(message);
              };
            }
            const value = Reflect.get(inner, innerProp);
            return typeof value === "function" ? value.bind(inner) : value;
          },
        });
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as PrismaClient;
}

function fakeResponse(body: string, options: { ok?: boolean; status?: number; contentType?: string } = {}): Response {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    text: async () => body,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? (options.contentType ?? "text/html") : null) },
  } as unknown as Response;
}

function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    return routes[url] ? routes[url]() : fakeResponse("", { ok: false, status: 404 });
  }) as typeof fetch;
}

const PRODUCT_PAGE = `<html><head><title>Kit TRAVO</title></head><body><main>
  <h1>Kit TRAVO</h1><p>El TRAVO es compatible con Hilux Revo desde 2016.</p>
</main></body></html>`;

const TESTIMONIAL_PAGE = `<html><head><title>Testimonios</title></head><body><main>
  <h1>Testimonios</h1><blockquote>Llegó en un día, excelente servicio.</blockquote>
</main></body></html>`;

function knowledgeExtractionResult(): string {
  return JSON.stringify({
    candidates: [
      {
        class: "FACTUAL",
        proposedCategory: "COMPATIBILITY",
        subject: "Hilux TRAVO",
        statement: "Compatible con Hilux Revo desde 2016.",
        evidenceRefIndex: 0,
        evidenceQuote: "El TRAVO es compatible con Hilux Revo desde 2016",
        confidence: 0.9,
      },
    ],
  });
}

describe.skipIf(!shouldRunDbTests)("sync-service — real pipeline against sales_os_test (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: KnowledgeTestFixture;

  beforeEach(async () => {
    fixture = await createKnowledgeTestFixture(db!, "sync-service-db");
  });

  afterEach(async () => {
    await cleanupKnowledgeTestFixture(db!, fixture);
  });

  it("discovers pages and creates DISCOVERED WebsitePage rows", async () => {
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com": () => fakeResponse(`<html><body><a href="/tienda">t</a></body></html>`),
      "https://koriakiimport.com/tienda": () => fakeResponse(PRODUCT_PAGE),
    });

    const result = await startWebsiteSync(
      { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, rootUrl: "https://koriakiimport.com" },
      db!,
      fetchFn,
    );

    expect(result.discoveredCount).toBe(2);

    const pages = await db!.websitePage.findMany({ where: { sourceId: result.sourceId } });
    expect(pages).toHaveLength(2);
    expect(pages.every((p) => p.status === "DISCOVERED")).toBe(true);

    const source = await db!.knowledgeSource.findUniqueOrThrow({ where: { id: result.sourceId } });
    expect(source.status).toBe("PROCESSING");
    expect(source.progressTotal).toBe(2);
  });

  it("processes a batch end to end: extracts, reinforces, and completes the source", async () => {
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com": () => fakeResponse(`<html><body></body></html>`),
    });
    const started = await startWebsiteSync(
      { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, rootUrl: "https://koriakiimport.com" },
      db!,
      fetchFn,
    );

    const pageFetch = fakeFetch({ "https://koriakiimport.com": () => fakeResponse(PRODUCT_PAGE) });
    const mock = createMockAIProvider({ knowledgeExtractionResponse: knowledgeExtractionResult() });

    const result = await processNextSyncBatch(started.sourceId, mock.provider, db!, pageFetch);

    expect(result.sourceStatus).toBe("COMPLETED");
    expect(result.extracted).toBe(1);
    expect(result.remaining).toBe(0);

    const page = await db!.websitePage.findFirstOrThrow({ where: { sourceId: started.sourceId } });
    expect(page.status).toBe("EXTRACTED");
    expect(page.pageContext).toBe("PRODUCT");
    expect(page.contentHash).toBeTruthy();
    expect(page.semanticAnalysisStatus).toBe("COMPLETED"); // a real LLM pass ran

    // The PRODUCT page's compatibility sentence fires the new deterministic
    // rule in addition to the mocked LLM's own candidate — both layers ran.
    // The deterministic candidate's subject is the page's own H1 ("Kit
    // TRAVO"), preferred over a dictionary-derived subject (Sprint 8
    // quality-fix review, item 2); the mocked LLM candidate keeps its own
    // fixed subject ("Hilux TRAVO").
    const candidates = await db!.knowledgeCandidate.findMany({ where: { businessId: fixture.businessId }, orderBy: { extractorName: "asc" } });
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.extractorName).sort()).toEqual(["deterministic", "kori"]);
    const deterministicCandidate = candidates.find((c) => c.extractorName === "deterministic")!;
    expect(deterministicCandidate.subject).toBe("Kit TRAVO");

    const evidence = await db!.knowledgeCandidateEvidence.findFirstOrThrow({ where: { candidateId: candidates[0].id } });
    expect(evidence.chunkContext).toBe("PRODUCT");

    const source = await db!.knowledgeSource.findUniqueOrThrow({ where: { id: started.sourceId } });
    expect(source.status).toBe("COMPLETED");
    expect(source.lastSyncedAt).not.toBeNull();
    expect(source.lastRunSummary).toMatchObject({ extracted: 1, failed: 0 });
  });

  it("skips re-extraction for a page whose content hasn't changed across a re-sync of the same reused source", async () => {
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com": () => fakeResponse(`<html><body></body></html>`),
    });
    const started = await startWebsiteSync(
      { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, rootUrl: "https://koriakiimport.com" },
      db!,
      fetchFn,
    );

    const pageFetch = fakeFetch({ "https://koriakiimport.com": () => fakeResponse(PRODUCT_PAGE) });
    const mock = createMockAIProvider({ knowledgeExtractionResponse: knowledgeExtractionResult() });
    await processNextSyncBatch(started.sourceId, mock.provider, db!, pageFetch);

    // Re-sync the same root/business — reuses the same source and resets
    // its existing page(s) back to DISCOVERED, but never touches their
    // stored contentHash, so re-fetching identical content correctly
    // produces SKIPPED_UNCHANGED without any manual seeding.
    const secondRun = await startWebsiteSync(
      { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, rootUrl: "https://koriakiimport.com" },
      db!,
      fetchFn,
    );
    expect(secondRun.sourceId).toBe(started.sourceId);

    const callCountBefore = mock.getKnowledgeExtractionCallCount();
    const result = await processNextSyncBatch(secondRun.sourceId, mock.provider, db!, pageFetch);

    expect(result.skippedUnchanged).toBe(1);
    expect(result.extracted).toBe(0);
    expect(mock.getKnowledgeExtractionCallCount()).toBe(callCountBefore); // no extraction call for an unchanged page

    const page = await db!.websitePage.findFirstOrThrow({ where: { sourceId: secondRun.sourceId } });
    expect(page.status).toBe("SKIPPED_UNCHANGED");
  });

  it("never produces a FACTUAL candidate from a TESTIMONIAL section, even end to end through the crawler", async () => {
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com": () => fakeResponse(`<html><body></body></html>`),
    });
    const started = await startWebsiteSync(
      { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, rootUrl: "https://koriakiimport.com" },
      db!,
      fetchFn,
    );

    const pageFetch = fakeFetch({ "https://koriakiimport.com": () => fakeResponse(TESTIMONIAL_PAGE) });
    // Simulate a misbehaving model trying to generalize the testimonial anyway.
    const mock = createMockAIProvider({
      knowledgeExtractionResponse: JSON.stringify({
        candidates: [
          {
            class: "FACTUAL",
            proposedCategory: "LOGISTICS",
            subject: "Tiempo de entrega",
            statement: "El tiempo de entrega estándar es un día.",
            evidenceRefIndex: 0,
            evidenceQuote: "Llegó en un día",
            confidence: 0.9,
          },
        ],
      }),
    });

    const result = await processNextSyncBatch(started.sourceId, mock.provider, db!, pageFetch);

    expect(result.extracted).toBe(1); // the page itself was processed/changed
    const candidates = await db!.knowledgeCandidate.findMany({ where: { businessId: fixture.businessId } });
    expect(candidates).toHaveLength(0); // but no candidate was persisted from it

    const page = await db!.websitePage.findFirstOrThrow({ where: { sourceId: started.sourceId } });
    expect(page.pageContext).toBe("TESTIMONIAL");
  });

  it("marks a fetch failure as FAILED and ends the source PARTIAL when other pages succeeded", async () => {
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com": () => fakeResponse(`<html><body><a href="/broken">b</a></body></html>`),
      "https://koriakiimport.com/broken": () => fakeResponse(PRODUCT_PAGE),
    });
    const started = await startWebsiteSync(
      { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, rootUrl: "https://koriakiimport.com" },
      db!,
      fetchFn,
    );

    const pageFetch = fakeFetch({
      "https://koriakiimport.com": () => fakeResponse(PRODUCT_PAGE),
      "https://koriakiimport.com/broken": () => fakeResponse("", { ok: false, status: 500 }),
    });
    const mock = createMockAIProvider({ knowledgeExtractionResponse: knowledgeExtractionResult() });

    const result = await processNextSyncBatch(started.sourceId, mock.provider, db!, pageFetch, 10);

    expect(result.failed).toBe(1);
    expect(result.sourceStatus).toBe("PARTIAL");

    const source = await db!.knowledgeSource.findUniqueOrThrow({ where: { id: started.sourceId } });
    expect(source.status).toBe("PARTIAL");
  });

  it("is a no-op when called again on an already-terminal source", async () => {
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com": () => fakeResponse(`<html><body></body></html>`),
    });
    const started = await startWebsiteSync(
      { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, rootUrl: "https://koriakiimport.com" },
      db!,
      fetchFn,
    );
    const pageFetch = fakeFetch({ "https://koriakiimport.com": () => fakeResponse(PRODUCT_PAGE) });
    const mock = createMockAIProvider({ knowledgeExtractionResponse: knowledgeExtractionResult() });
    await processNextSyncBatch(started.sourceId, mock.provider, db!, pageFetch);

    const secondCall = await processNextSyncBatch(started.sourceId, mock.provider, db!, pageFetch);

    expect(secondCall).toEqual({ processed: 0, extracted: 0, skippedUnchanged: 0, failed: 0, remaining: 0, sourceStatus: "COMPLETED" });
  });

  // --- Regression coverage for the Sprint 8 acceptance bug -----------------

  it("successful initialization: source ends PROCESSING with progress set and no error", async () => {
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com": () => fakeResponse(`<html><body><a href="/tienda">t</a></body></html>`),
      "https://koriakiimport.com/tienda": () => fakeResponse(PRODUCT_PAGE),
    });

    const result = await startWebsiteSync(
      { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, rootUrl: "https://koriakiimport.com" },
      db!,
      fetchFn,
    );

    const source = await db!.knowledgeSource.findUniqueOrThrow({ where: { id: result.sourceId } });
    expect(source.status).toBe("PROCESSING");
    expect(source.progressTotal).toBe(2);
    expect(source.progressCompleted).toBe(0);
    expect(source.errorMessage).toBeNull();
  });

  it("initialization failure: a write failure after KnowledgeSource creation persists FAILED with the real error, not a permanent PENDING row", async () => {
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com": () => fakeResponse(`<html><body><a href="/tienda">t</a></body></html>`),
      "https://koriakiimport.com/tienda": () => fakeResponse(PRODUCT_PAGE),
    });
    const failingDb = withFailingPageUpsert(db!, "Simulated DB failure during page upsert");

    await expect(
      startWebsiteSync(
        { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, rootUrl: "https://koriakiimport.com" },
        failingDb,
        fetchFn,
      ),
    ).rejects.toThrow("Simulated DB failure during page upsert");

    // Read back through the real (non-failing) client — exactly one source
    // row exists, and it's FAILED with the real cause captured, never stuck
    // at PENDING forever.
    const sources = await db!.knowledgeSource.findMany({
      where: { businessId: fixture.businessId, sourceType: "WEBSITE", label: "https://koriakiimport.com" },
    });
    expect(sources).toHaveLength(1);
    expect(sources[0].status).toBe("FAILED");
    expect(sources[0].errorMessage).toBe("Simulated DB failure during page upsert");
  });

  it("duplicate Sync Now calls for the same business/root reuse the existing source instead of creating another one", async () => {
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com": () => fakeResponse(`<html><body></body></html>`),
    });

    const first = await startWebsiteSync(
      { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, rootUrl: "https://koriakiimport.com" },
      db!,
      fetchFn,
    );
    const second = await startWebsiteSync(
      // Trailing slash — must normalize to the same source as the first call.
      { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, rootUrl: "https://koriakiimport.com/" },
      db!,
      fetchFn,
    );

    expect(second.sourceId).toBe(first.sourceId);

    const sources = await db!.knowledgeSource.findMany({ where: { businessId: fixture.businessId, sourceType: "WEBSITE" } });
    expect(sources).toHaveLength(1);
  });

  it("does not reuse a source belonging to a different business, even for the same root URL", async () => {
    const otherFixture = await createKnowledgeTestFixture(db!, "sync-service-db-other");
    try {
      const fetchFn = fakeFetch({
        "https://koriakiimport.com/robots.txt": () => fakeResponse("", { ok: false }),
        "https://koriakiimport.com/sitemap.xml": () => fakeResponse("", { ok: false }),
        "https://koriakiimport.com": () => fakeResponse(`<html><body></body></html>`),
      });

      const first = await startWebsiteSync(
        { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, rootUrl: "https://koriakiimport.com" },
        db!,
        fetchFn,
      );
      const second = await startWebsiteSync(
        { businessId: otherFixture.businessId, createdByUserId: otherFixture.ownerUserId, rootUrl: "https://koriakiimport.com" },
        db!,
        fetchFn,
      );

      expect(second.sourceId).not.toBe(first.sourceId);
    } finally {
      await cleanupKnowledgeTestFixture(db!, otherFixture);
    }
  });

  // --- Zero-cost mode (Sprint 8 review) -------------------------------------

  it("zero-AI mode: ingestion completes, deterministic candidates are created, and nothing is ever FAILED for lack of AI", async () => {
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com": () => fakeResponse(`<html><body></body></html>`),
    });
    const started = await startWebsiteSync(
      { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, rootUrl: "https://koriakiimport.com" },
      db!,
      fetchFn,
    );

    const pageFetch = fakeFetch({ "https://koriakiimport.com": () => fakeResponse(PRODUCT_PAGE) });

    // No AI provider at all — undefined, not a mock. This is the real
    // shape of tryGetAIProvider()'s return value when AI_PROVIDER/AI_MODEL/
    // ANTHROPIC_API_KEY aren't configured.
    const result = await processNextSyncBatch(started.sourceId, undefined, db!, pageFetch);

    expect(result.sourceStatus).toBe("COMPLETED");
    expect(result.failed).toBe(0);

    const page = await db!.websitePage.findFirstOrThrow({ where: { sourceId: started.sourceId } });
    expect(page.status).toBe("EXTRACTED"); // ingestion succeeded
    expect(page.semanticAnalysisStatus).toBe("PENDING"); // never COMPLETED — no LLM pass ran

    const candidates = await db!.knowledgeCandidate.findMany({ where: { businessId: fixture.businessId } });
    expect(candidates).toHaveLength(1);
    // Subject is the page's own H1 ("Kit TRAVO"), not a dictionary
    // reconstruction — Sprint 8 quality-fix review, item 2.
    expect(candidates[0]).toMatchObject({ subject: "Kit TRAVO", extractorName: "deterministic" });

    const source = await db!.knowledgeSource.findUniqueOrThrow({ where: { id: started.sourceId } });
    expect(source.status).toBe("COMPLETED"); // never FAILED for lack of AI
  });

  it("zero-AI mode: a page with nothing deterministic-worthy still completes as NOT_NEEDED, not PENDING or FAILED", async () => {
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com": () => fakeResponse(`<html><body></body></html>`),
    });
    const started = await startWebsiteSync(
      { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, rootUrl: "https://koriakiimport.com" },
      db!,
      fetchFn,
    );

    const marketingOnlyPage = `<html><head><title>Nosotros</title></head><body><main><h1>Nosotros</h1><p>¡Somos los líderes del mercado en accesorios para camionetas en todo el Perú!</p></main></body></html>`;
    const pageFetch = fakeFetch({ "https://koriakiimport.com": () => fakeResponse(marketingOnlyPage) });

    const result = await processNextSyncBatch(started.sourceId, undefined, db!, pageFetch);

    expect(result.sourceStatus).toBe("COMPLETED");
    const page = await db!.websitePage.findFirstOrThrow({ where: { sourceId: started.sourceId } });
    expect(page.status).toBe("EXTRACTED");
    expect(page.semanticAnalysisStatus).toBe("NOT_NEEDED");

    const candidates = await db!.knowledgeCandidate.findMany({ where: { businessId: fixture.businessId } });
    expect(candidates).toHaveLength(0);
  });
});
