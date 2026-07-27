// Website sync persistence + the bounded incremental batch runner (Sprint 8
// review, item 2): startWebsiteSync discovers and records pages as
// DISCOVERED (a work queue, not a separate queue table); processNextSyncBatch
// processes up to `batchSize` of them per call and can be invoked repeatedly
// — by client polling today, or by a real queue/worker later reading/writing
// the exact same WebsitePage.status/KnowledgeSource.progress* columns — with
// no change to those contracts either way.

import { createHash } from "node:crypto";
import { prisma } from "@/server/db/client";
import type { KnowledgeSourceStatus, PrismaClient, WebsitePageContext } from "@/server/db/generated/client";
import type { AIProvider } from "@/server/intelligence/ai-provider";
import { extractKnowledgeCandidates } from "../extract";
import { fromWebsitePageSections } from "../extraction-input";
import { reinforceCandidate } from "../reinforcement";
import type { ExtractionSectionContext } from "../types";
import { discoverPages } from "./discovery";
import { extractPageContent } from "./page-extraction";

const DEFAULT_BATCH_SIZE = 5;

export interface StartWebsiteSyncInput {
  businessId: string;
  createdByUserId: string;
  rootUrl: string;
}

export interface StartWebsiteSyncResult {
  sourceId: string;
  discoveredCount: number;
  method: "SITEMAP" | "CRAWL";
}

export async function startWebsiteSync(
  input: StartWebsiteSyncInput,
  db: PrismaClient = prisma,
  fetchFn: typeof fetch = fetch,
): Promise<StartWebsiteSyncResult> {
  const source = await db.knowledgeSource.create({
    data: {
      businessId: input.businessId,
      sourceType: "WEBSITE",
      label: input.rootUrl,
      status: "PENDING",
      createdByUserId: input.createdByUserId,
    },
  });

  const discovery = await discoverPages(input.rootUrl, { fetchFn });

  await db.$transaction([
    ...discovery.urls.map((url) =>
      db.websitePage.upsert({
        where: { sourceId_url: { sourceId: source.id, url } },
        update: {},
        create: { businessId: input.businessId, sourceId: source.id, url, status: "DISCOVERED" },
      }),
    ),
    db.knowledgeSource.update({
      where: { id: source.id },
      data: { status: "PROCESSING", progressTotal: discovery.urls.length, progressCompleted: 0, progressFailed: 0 },
    }),
  ]);

  return { sourceId: source.id, discoveredCount: discovery.urls.length, method: discovery.method };
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
 */
export async function processNextSyncBatch(
  sourceId: string,
  aiProvider: AIProvider,
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
          })),
        ),
      };

      const extraction = await extractKnowledgeCandidates(extractionInput, { aiProvider });
      for (const candidate of extraction.candidates) {
        await reinforceCandidate(
          { businessId: source.businessId, originSourceId: sourceId, extractorName: "kori", extractorVersion: extraction.extractorVersion, extracted: candidate },
          aiProvider,
          db,
        );
      }

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
