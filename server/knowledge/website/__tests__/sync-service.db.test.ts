// Gated: proves sync-service.ts's full "discover -> bounded batch process ->
// extract -> reinforce" pipeline against sales_os_test only, with fetch and
// the AI provider both faked (no real network, no real LLM calls).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAIProvider } from "@/server/intelligence/testing/mock-ai-provider";
import { cleanupKnowledgeTestFixture, createKnowledgeTestFixture, getTestPrisma, shouldRunDbTests, type KnowledgeTestFixture } from "../../__tests__/test-db";
import { processNextSyncBatch, startWebsiteSync } from "../sync-service";

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
      "https://koriakiimport.com/": () => fakeResponse(`<html><body><a href="/tienda">t</a></body></html>`),
      "https://koriakiimport.com/tienda": () => fakeResponse(PRODUCT_PAGE),
    });

    const result = await startWebsiteSync(
      { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, rootUrl: "https://koriakiimport.com/" },
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
      "https://koriakiimport.com/": () => fakeResponse(`<html><body></body></html>`),
    });
    const started = await startWebsiteSync(
      { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, rootUrl: "https://koriakiimport.com/" },
      db!,
      fetchFn,
    );

    const pageFetch = fakeFetch({ "https://koriakiimport.com/": () => fakeResponse(PRODUCT_PAGE) });
    const mock = createMockAIProvider({ knowledgeExtractionResponse: knowledgeExtractionResult() });

    const result = await processNextSyncBatch(started.sourceId, mock.provider, db!, pageFetch);

    expect(result.sourceStatus).toBe("COMPLETED");
    expect(result.extracted).toBe(1);
    expect(result.remaining).toBe(0);

    const page = await db!.websitePage.findFirstOrThrow({ where: { sourceId: started.sourceId } });
    expect(page.status).toBe("EXTRACTED");
    expect(page.pageContext).toBe("PRODUCT");
    expect(page.contentHash).toBeTruthy();

    const candidates = await db!.knowledgeCandidate.findMany({ where: { businessId: fixture.businessId } });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].subject).toBe("Hilux TRAVO");

    const evidence = await db!.knowledgeCandidateEvidence.findFirstOrThrow({ where: { candidateId: candidates[0].id } });
    expect(evidence.chunkContext).toBe("PRODUCT");

    const source = await db!.knowledgeSource.findUniqueOrThrow({ where: { id: started.sourceId } });
    expect(source.status).toBe("COMPLETED");
    expect(source.lastSyncedAt).not.toBeNull();
    expect(source.lastRunSummary).toMatchObject({ extracted: 1, failed: 0 });
  });

  it("skips re-extraction for a page whose content hasn't changed", async () => {
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/": () => fakeResponse(`<html><body></body></html>`),
    });
    const started = await startWebsiteSync(
      { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, rootUrl: "https://koriakiimport.com/" },
      db!,
      fetchFn,
    );

    const pageFetch = fakeFetch({ "https://koriakiimport.com/": () => fakeResponse(PRODUCT_PAGE) });
    const mock = createMockAIProvider({ knowledgeExtractionResponse: knowledgeExtractionResult() });
    await processNextSyncBatch(started.sourceId, mock.provider, db!, pageFetch);

    // Re-run the whole sync against the same (unchanged) page.
    const secondRun = await startWebsiteSync(
      { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, rootUrl: "https://koriakiimport.com/" },
      db!,
      fetchFn,
    );
    // Seed the previous contentHash onto the newly (re-)discovered page row to simulate "we've seen this before, unchanged".
    const previousPage = await db!.websitePage.findFirstOrThrow({ where: { sourceId: started.sourceId } });
    await db!.websitePage.updateMany({ where: { sourceId: secondRun.sourceId }, data: { contentHash: previousPage.contentHash } });

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
      "https://koriakiimport.com/": () => fakeResponse(`<html><body></body></html>`),
    });
    const started = await startWebsiteSync(
      { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, rootUrl: "https://koriakiimport.com/" },
      db!,
      fetchFn,
    );

    const pageFetch = fakeFetch({ "https://koriakiimport.com/": () => fakeResponse(TESTIMONIAL_PAGE) });
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
      "https://koriakiimport.com/": () => fakeResponse(`<html><body><a href="/broken">b</a></body></html>`),
      "https://koriakiimport.com/broken": () => fakeResponse(PRODUCT_PAGE),
    });
    const started = await startWebsiteSync(
      { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, rootUrl: "https://koriakiimport.com/" },
      db!,
      fetchFn,
    );

    const pageFetch = fakeFetch({
      "https://koriakiimport.com/": () => fakeResponse(PRODUCT_PAGE),
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
      "https://koriakiimport.com/": () => fakeResponse(`<html><body></body></html>`),
    });
    const started = await startWebsiteSync(
      { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, rootUrl: "https://koriakiimport.com/" },
      db!,
      fetchFn,
    );
    const pageFetch = fakeFetch({ "https://koriakiimport.com/": () => fakeResponse(PRODUCT_PAGE) });
    const mock = createMockAIProvider({ knowledgeExtractionResponse: knowledgeExtractionResult() });
    await processNextSyncBatch(started.sourceId, mock.provider, db!, pageFetch);

    const secondCall = await processNextSyncBatch(started.sourceId, mock.provider, db!, pageFetch);

    expect(secondCall).toEqual({ processed: 0, extracted: 0, skippedUnchanged: 0, failed: 0, remaining: 0, sourceStatus: "COMPLETED" });
  });
});
