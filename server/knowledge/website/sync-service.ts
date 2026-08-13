// Website sync persistence + the bounded incremental batch runner (Sprint 8
// review, item 2): startWebsiteSync discovers and records pages as
// DISCOVERED (a work queue, not a separate queue table); processNextSyncBatch
// processes up to `batchSize` of them per call and can be invoked repeatedly
// — by client polling today, or by a real queue/worker later reading/writing
// the exact same WebsitePage.status/KnowledgeSource.progress* columns — with
// no change to those contracts either way.

import { createHash } from "node:crypto";
import { prisma } from "@/server/db/client";
import type { KnowledgeSourceStatus, PrismaClient, SemanticAnalysisStatus, WebsitePageContext } from "@/server/db/generated/client";
import type { AIProvider } from "@/server/intelligence/ai-provider";
import { DETERMINISTIC_EXTRACTOR_NAME, DETERMINISTIC_EXTRACTOR_VERSION, extractDeterministicCandidates } from "../deterministic/deterministic-extract";
import { extractKnowledgeCandidates } from "../extract";
import { fromWebsitePageSections } from "../extraction-input";
import { reinforceCandidate } from "../reinforcement";
import type { ExtractionSectionContext } from "../types";
import { discoverPages, type DiscoveryMethod } from "./discovery";
import { extractPageContent } from "./page-extraction";
import { canonicalizeUrl } from "./url-utils";

const DEFAULT_BATCH_SIZE = 5;

export interface StartWebsiteSyncInput {
  businessId: string;
  createdByUserId: string;
  rootUrl: string;
}

export interface StartWebsiteSyncResult {
  sourceId: string;
  discoveredCount: number;
  method: DiscoveryMethod;
}

/**
 * Same URL modulo trailing slash / query-string noise is the same source —
 * "https://koriakiimport.com" and "https://koriakiimport.com/" must not
 * become two rows. Shares its canonicalization rules with page-level dedup
 * during discovery (url-utils.ts) — a root URL is just a page URL at the
 * source level.
 */
function normalizeRootUrl(rootUrl: string): string {
  return canonicalizeUrl(rootUrl);
}

export async function startWebsiteSync(
  input: StartWebsiteSyncInput,
  db: PrismaClient = prisma,
  fetchFn: typeof fetch = fetch,
): Promise<StartWebsiteSyncResult> {
  const normalizedRootUrl = normalizeRootUrl(input.rootUrl);

  // Reuse — never create a second KnowledgeSource for the same normalized
  // root within the same business (Sprint 8 acceptance bug). "Sync now"
  // again on an existing source starts a new run ON that source: reset its
  // status/progress and put every one of its pages back in the DISCOVERED
  // queue so processNextSyncBatch's existing content-hash comparison is
  // what decides EXTRACTED vs. SKIPPED_UNCHANGED, exactly as it already does
  // for a brand-new source.
  const existing = await db.knowledgeSource.findFirst({
    where: { businessId: input.businessId, sourceType: "WEBSITE", label: normalizedRootUrl },
  });

  const source = existing
    ? await db.knowledgeSource.update({
        where: { id: existing.id },
        data: { status: "PENDING", errorMessage: null, progressTotal: null, progressCompleted: null, progressFailed: null },
      })
    : await db.knowledgeSource.create({
        data: {
          businessId: input.businessId,
          sourceType: "WEBSITE",
          label: normalizedRootUrl,
          status: "PENDING",
          createdByUserId: input.createdByUserId,
        },
      });

  if (existing) {
    await db.websitePage.updateMany({ where: { sourceId: source.id }, data: { status: "DISCOVERED" } });
  }

  try {
    const discovery = await discoverPages(normalizedRootUrl, { fetchFn });

    // Plain concurrent writes, not a single $transaction([...]) — each
    // upsert is independently correct (idempotent on sourceId+url) and has
    // no cross-row atomicity requirement, so there's nothing an all-or-
    // nothing transaction actually buys here. Wrapping dozens of these in
    // one Prisma interactive transaction is exactly what caused the
    // acceptance bug: against the pooled pilot DB, a real site's page count
    // reliably exceeds Prisma's default 5000ms transaction timeout
    // (confirmed: 43 pages took 6252ms and threw P2028).
    await Promise.all(
      discovery.urls.map((url) =>
        db.websitePage.upsert({
          where: { sourceId_url: { sourceId: source.id, url } },
          update: {},
          create: { businessId: input.businessId, sourceId: source.id, url, status: "DISCOVERED" },
        }),
      ),
    );

    await db.knowledgeSource.update({
      where: { id: source.id },
      data: { status: "PROCESSING", progressTotal: discovery.urls.length, progressCompleted: 0, progressFailed: 0 },
    });

    return { sourceId: source.id, discoveredCount: discovery.urls.length, method: discovery.method };
  } catch (error) {
    // A failed initialization must never leave an unexplained permanent
    // PENDING row: persist FAILED + the real cause, and log it server-side
    // — toApplicationResult (server/application/errors.ts) still maps this
    // to a safe generic message for the client, but the actual cause must
    // not be lost.
    const message = error instanceof Error ? error.message : "Website sync initialization failed.";
    console.error(`[knowledge] startWebsiteSync failed for source ${source.id} (${normalizedRootUrl}):`, error);
    await db.knowledgeSource.update({ where: { id: source.id }, data: { status: "FAILED", errorMessage: message } });
    throw error;
  }
}

export interface ProcessSyncBatchResult {
  processed: number;
  extracted: number;
  skippedUnchanged: number;
  failed: number;
  remaining: number;
  sourceStatus: KnowledgeSourceStatus;
}

const TERMINAL_STATUSES: KnowledgeSourceStatus[] = ["COMPLETED", "PARTIAL", "FAILED"];

/**
 * Processes one bounded batch of DISCOVERED pages for a source. Safe to
 * call repeatedly (e.g. client polling after each call) until
 * sourceStatus is terminal — the UI's "Sync started -> PROCESSING ->
 * progress -> COMPLETED/PARTIAL/FAILED" flow is just this function called
 * in a loop, never one long-held request for the whole site.
 *
 * `aiProvider` is optional (Sprint 8 zero-cost mode review, item 3) —
 * deterministic extraction always runs; LLM extraction runs additionally
 * when a provider is supplied. Ingestion (fetch/parse/hash/persist) never
 * fails, and a page's status/the source's status never becomes FAILED,
 * because of AI availability — only genuine fetch/parse failures do.
 */
export async function processNextSyncBatch(
  sourceId: string,
  aiProvider: AIProvider | undefined,
  db: PrismaClient = prisma,
  fetchFn: typeof fetch = fetch,
  batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<ProcessSyncBatchResult> {
  const source = await db.knowledgeSource.findUniqueOrThrow({ where: { id: sourceId } });

  if (TERMINAL_STATUSES.includes(source.status)) {
    return { processed: 0, extracted: 0, skippedUnchanged: 0, failed: 0, remaining: 0, sourceStatus: source.status };
  }

  const batch = await db.websitePage.findMany({ where: { sourceId, status: "DISCOVERED" }, take: batchSize });

  let extracted = 0;
  let skippedUnchanged = 0;
  let failed = 0;

  for (const page of batch) {
    try {
      const response = await fetchFn(page.url);
      if (!response.ok || !(response.headers.get("content-type") ?? "").includes("text/html")) {
        await db.websitePage.update({ where: { id: page.id }, data: { status: "FAILED", httpStatus: response.status, lastSeenAt: new Date() } });
        failed += 1;
        continue;
      }

      const html = await response.text();
      const content = extractPageContent(html, page.url);
      const contentHash = createHash("sha256").update(content.fullText).digest("hex");

      if (page.contentHash && contentHash === page.contentHash) {
        await db.websitePage.update({
          where: { id: page.id },
          data: { status: "SKIPPED_UNCHANGED", httpStatus: response.status, lastSeenAt: new Date() },
        });
        skippedUnchanged += 1;
        continue;
      }

      // Ingestion itself succeeds here regardless of what happens next —
      // status flips to EXTRACTED before extraction (deterministic or LLM)
      // is even attempted, and nothing below this point ever reverts it or
      // marks the page FAILED (Sprint 8 zero-cost mode review, item 7).
      await db.websitePage.update({
        where: { id: page.id },
        data: {
          status: "EXTRACTED",
          title: content.title,
          extractedText: content.fullText,
          contentHash,
          pageContext: content.dominantContext as WebsitePageContext,
          httpStatus: response.status,
          lastSeenAt: new Date(),
          lastChangedAt: new Date(),
        },
      });

      const extractionInput = {
        kind: "DOCUMENT" as const,
        document: fromWebsitePageSections(
          { id: page.id, url: page.url, title: content.title },
          content.sections.map((section, index) => ({
            id: `${page.id}-${index}`,
            context: section.context as ExtractionSectionContext,
            heading: section.heading,
            text: section.text,
            subjectHint: section.subjectHint,
            reliable: section.reliable,
          })),
        ),
      };

      // Always runs, AI or not — deterministic candidates and the
      // NOT_NEEDED/PENDING assessment are independent of each other and of
      // AI availability.
      const deterministic = extractDeterministicCandidates(extractionInput);
      for (const candidate of deterministic.candidates) {
        await reinforceCandidate(
          {
            businessId: source.businessId,
            originSourceId: sourceId,
            extractorName: DETERMINISTIC_EXTRACTOR_NAME,
            extractorVersion: DETERMINISTIC_EXTRACTOR_VERSION,
            extracted: candidate,
          },
          aiProvider,
          db,
        );
      }

      let semanticAnalysisStatus: SemanticAnalysisStatus = deterministic.semanticAnalysisStatus;

      if (aiProvider) {
        try {
          const extraction = await extractKnowledgeCandidates(extractionInput, { aiProvider });
          for (const candidate of extraction.candidates) {
            await reinforceCandidate(
              { businessId: source.businessId, originSourceId: sourceId, extractorName: "kori", extractorVersion: extraction.extractorVersion, extracted: candidate },
              aiProvider,
              db,
            );
          }
          semanticAnalysisStatus = "COMPLETED"; // a real LLM pass ran, regardless of what it found
        } catch (llmError) {
          // A genuine LLM failure (malformed output, provider error) is not
          // an ingestion failure — the page already succeeded above. Leave
          // semanticAnalysisStatus at the deterministic assessment so a
          // later retry still picks this page up.
          console.error(`[knowledge] LLM extraction failed for WebsitePage ${page.id} (${page.url}), ingestion unaffected:`, llmError);
        }
      }

      await db.websitePage.update({ where: { id: page.id }, data: { semanticAnalysisStatus } });

      extracted += 1;
    } catch {
      await db.websitePage.update({ where: { id: page.id }, data: { status: "FAILED", lastSeenAt: new Date() } });
      failed += 1;
    }
  }

  const processed = batch.length;
  const successes = extracted + skippedUnchanged;
  const remaining = await db.websitePage.count({ where: { sourceId, status: "DISCOVERED" } });

  const totalCompleted = (source.progressCompleted ?? 0) + successes;
  const totalFailed = (source.progressFailed ?? 0) + failed;

  let sourceStatus: KnowledgeSourceStatus = "PROCESSING";
  let finalSummary: { pagesProcessed: number; extracted: number; skippedUnchanged: number; failed: number } | null = null;
  if (remaining === 0) {
    sourceStatus = totalFailed === 0 ? "COMPLETED" : totalCompleted > 0 ? "PARTIAL" : "FAILED";
    // Cumulative across every batch of this run, not just the last one —
    // counted from WebsitePage.status rather than accumulated in memory,
    // since this function may be invoked as separate calls/requests.
    const [totalExtracted, totalSkipped] = await Promise.all([
      db.websitePage.count({ where: { sourceId, status: "EXTRACTED" } }),
      db.websitePage.count({ where: { sourceId, status: "SKIPPED_UNCHANGED" } }),
    ]);
    finalSummary = { pagesProcessed: totalCompleted + totalFailed, extracted: totalExtracted, skippedUnchanged: totalSkipped, failed: totalFailed };
  }

  await db.knowledgeSource.update({
    where: { id: sourceId },
    data: {
      status: sourceStatus,
      progressCompleted: { increment: successes },
      progressFailed: { increment: failed },
      ...(finalSummary ? { lastSyncedAt: new Date(), lastRunSummary: finalSummary } : {}),
    },
  });

  return { processed, extracted, skippedUnchanged, failed, remaining, sourceStatus };
}
