// Application handler behind the conversation-import server actions
// (server/actions/knowledge.ts). Same conventions as
// server/application/whatsapp-actions.ts: authenticate -> authorize (OWNER
// only — Sprint 8 review, item 3: workers never manually enter knowledge,
// and only an OWNER may trigger ingestion or approve a promotion) ->
// validate -> call the domain layer -> map the result/error.
//
// This is the one place that wires parser -> persistence -> extraction ->
// reinforcement together end to end. It never re-implements any of those —
// see server/knowledge/whatsapp-import/{parser,import-service}.ts,
// server/knowledge/extract.ts, server/knowledge/reinforcement.ts.

import {
  analyzeConversationImportSchema,
  processSyncBatchSchema,
  promoteCandidateSchema,
  rejectCandidateSchema,
  startWebsiteSyncSchema,
} from "@/lib/validations/knowledge";
import { fetchKnownBusinessNames } from "@/server/application/known-business-names";
import { prisma } from "@/server/db/client";
import type { PrismaClient } from "@/server/db/generated/client";
import type { AIProvider } from "@/server/intelligence/ai-provider";
import { extractKnowledgeCandidates } from "@/server/knowledge/extract";
import { fromImportedMessages } from "@/server/knowledge/extraction-input";
import {
  createImportSource,
  findImportedConversationByFileHash,
  markImportSourceFailed,
  persistParsedConversation,
} from "@/server/knowledge/whatsapp-import/import-service";
import { parseWhatsAppExport } from "@/server/knowledge/whatsapp-import/parser";
import { promoteCandidate, rejectCandidate, type PromoteCandidateResult } from "@/server/knowledge/promotion";
import { reinforceCandidate } from "@/server/knowledge/reinforcement";
import { processNextSyncBatch, startWebsiteSync, type ProcessSyncBatchResult, type StartWebsiteSyncResult } from "@/server/knowledge/website/sync-service";
import type { z } from "zod";
import { type AuthContextResolver, type AuthenticatedUser, defaultAuthContextResolver, requireAuthenticatedUser } from "./auth";
import { getAIProvider } from "./composition-root";
import { type ApplicationResult, ForbiddenError, InvalidInputError, NotFoundError, toApplicationResult } from "./errors";

function parseOrThrow<Schema extends z.ZodTypeAny>(schema: Schema, rawInput: unknown): z.infer<Schema> {
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    throw new InvalidInputError(parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}

/**
 * Knowledge ingestion (triggering an import/sync, and — separately, see the
 * future promotion layer — approving a candidate) is OWNER-only. Browsing
 * the resulting Knowledge Base stays open to every role; this function only
 * gates the mutating/expensive actions, same split as Observer Console's
 * assertObserverConsoleAccess vs. its own read-only surface.
 */
function assertKnowledgeIngestionAccess(user: AuthenticatedUser): void {
  if (user.role !== "OWNER") {
    throw new ForbiddenError("Solo el propietario del negocio puede administrar la ingestión de conocimiento (importaciones, sincronizaciones y revisión de candidatos).");
  }
}

// Koriaki/Peru pilot default (Sprint 8 review, item 1) — not yet a
// per-business setting; the schema (ImportedConversation.dateOrder/timezone)
// already supports one, this is just where the default currently lives.
const DEFAULT_DATE_ORDER = "DMY" as const;
const DEFAULT_TIMEZONE = "America/Lima";

export interface AnalyzeConversationImportSummary {
  messagesAnalyzed: number;
  candidatesFound: number;
  reinforced: number;
  conflicts: number;
}

export type AnalyzeConversationImportResult =
  | {
      status: "NEEDS_PARTICIPANT_RESOLUTION";
      candidateLabels: [string, string];
    }
  | {
      status: "COMPLETED";
      sourceId: string;
      summary: AnalyzeConversationImportSummary;
    };

export interface AnalyzeConversationImportDependencies {
  resolver?: AuthContextResolver;
  aiProvider?: AIProvider;
  /** Injectable so the gated test suite exercises this against sales_os_test only, never the pilot DATABASE_URL — same reasoning as every Prisma*Repository/gateway default. */
  db?: PrismaClient;
}

export function analyzeConversationImportHandler(
  rawInput: unknown,
  dependencies: AnalyzeConversationImportDependencies = {},
): Promise<ApplicationResult<AnalyzeConversationImportResult>> {
  return toApplicationResult(async () => {
    const db = dependencies.db ?? prisma;
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    assertKnowledgeIngestionAccess(user);
    const input = parseOrThrow(analyzeConversationImportSchema, rawInput);

    if (input.rawFileHash) {
      const existing = await findImportedConversationByFileHash(user.businessId, input.rawFileHash, db);
      if (existing) {
        throw new InvalidInputError({ file: ["Este archivo ya fue importado."] });
      }
    }

    const knownBusinessNames = await fetchKnownBusinessNames(user.businessId, db);

    const parsed = parseWhatsAppExport({
      rawText: input.rawText,
      dateOrder: DEFAULT_DATE_ORDER,
      timezone: DEFAULT_TIMEZONE,
      knownBusinessNames,
      manualBusinessSenderLabel: input.manualBusinessSenderLabel,
    });

    if (parsed.needsParticipantResolution) {
      return { status: "NEEDS_PARTICIPANT_RESOLUTION", candidateLabels: parsed.candidateLabels };
    }

    const source = await createImportSource(
      { businessId: user.businessId, createdByUserId: user.id, label: input.sourceConversationId },
      db,
    );

    const conversation = await persistParsedConversation(
      {
        businessId: user.businessId,
        sourceId: source.id,
        externalSource: input.externalSource,
        sourceConversationId: input.sourceConversationId,
        dateOrder: DEFAULT_DATE_ORDER,
        timezone: DEFAULT_TIMEZONE,
        rawFileHash: input.rawFileHash,
        parsed,
      },
      db,
    ).catch(async (error) => {
      await markImportSourceFailed(source.id, error instanceof Error ? error.message : "Failed to persist the parsed conversation.", db);
      throw error;
    });

    const aiProvider = dependencies.aiProvider ?? getAIProvider();
    const extractionInput = { kind: "CONVERSATION" as const, messages: fromImportedMessages(conversation.messages) };

    const extraction = await extractKnowledgeCandidates(extractionInput, { aiProvider }).catch(async (error) => {
      await markImportSourceFailed(source.id, error instanceof Error ? error.message : "Knowledge extraction failed.", db);
      throw error;
    });

    let newCount = 0;
    let reinforcedCount = 0;
    let conflictCount = 0;
    for (const candidate of extraction.candidates) {
      const result = await reinforceCandidate(
        {
          businessId: user.businessId,
          originSourceId: source.id,
          extractorName: "kori",
          extractorVersion: extraction.extractorVersion,
          extracted: candidate,
        },
        aiProvider,
        db,
      );
      if (result.status === "CONFLICT") conflictCount += 1;
      else if (result.outcome === "MERGED") reinforcedCount += 1;
      else newCount += 1;
    }

    const summary: AnalyzeConversationImportSummary = {
      messagesAnalyzed: conversation.messages.length,
      candidatesFound: newCount,
      reinforced: reinforcedCount,
      conflicts: conflictCount,
    };

    await db.knowledgeSource.update({
      where: { id: source.id },
      data: { status: "COMPLETED", lastRunSummary: summary as unknown as object },
    });

    return { status: "COMPLETED", sourceId: source.id, summary };
  });
}

// --- Website sync -------------------------------------------------------------

export interface StartWebsiteSyncDependencies {
  resolver?: AuthContextResolver;
  db?: PrismaClient;
  fetchFn?: typeof fetch;
}

/**
 * Discovers and records pages only (Sprint 8 review, item 2) — never
 * fetches/extracts/analyzes a single page itself. Returns immediately; the
 * UI drives processSyncBatchHandler in a poll loop afterward, so no browser
 * request is ever held open for the whole crawl.
 */
export function startWebsiteSyncHandler(
  rawInput: unknown,
  dependencies: StartWebsiteSyncDependencies = {},
): Promise<ApplicationResult<StartWebsiteSyncResult>> {
  return toApplicationResult(async () => {
    const db = dependencies.db ?? prisma;
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    assertKnowledgeIngestionAccess(user);
    const input = parseOrThrow(startWebsiteSyncSchema, rawInput);

    return startWebsiteSync({ businessId: user.businessId, createdByUserId: user.id, rootUrl: input.rootUrl }, db, dependencies.fetchFn);
  });
}

export interface ProcessSyncBatchDependencies {
  resolver?: AuthContextResolver;
  db?: PrismaClient;
  fetchFn?: typeof fetch;
  aiProvider?: AIProvider;
}

/**
 * Processes one bounded batch (server/knowledge/website/sync-service.ts) and
 * returns — the client calls this again to continue, checking
 * result.sourceStatus for the terminal states, exactly the
 * "Sync started -> PROCESSING -> progress -> COMPLETED/PARTIAL/FAILED" flow
 * from Sprint 8 Phase 9's UI spec.
 */
export function processSyncBatchHandler(
  rawInput: unknown,
  dependencies: ProcessSyncBatchDependencies = {},
): Promise<ApplicationResult<ProcessSyncBatchResult>> {
  return toApplicationResult(async () => {
    const db = dependencies.db ?? prisma;
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    assertKnowledgeIngestionAccess(user);
    const input = parseOrThrow(processSyncBatchSchema, rawInput);

    // Tenant-scope before ever touching the source — processNextSyncBatch
    // itself takes a bare sourceId with no businessId check, same reasoning
    // as every other loadAuthorized*/assert* pair in access-control.ts.
    const source = await db.knowledgeSource.findFirst({ where: { id: input.sourceId, businessId: user.businessId }, select: { id: true } });
    if (!source) {
      throw new NotFoundError("la fuente de conocimiento");
    }

    const aiProvider = dependencies.aiProvider ?? getAIProvider();
    return processNextSyncBatch(input.sourceId, aiProvider, db, dependencies.fetchFn);
  });
}

// --- Candidate review/promotion -------------------------------------------------

export interface CandidateReviewDependencies {
  resolver?: AuthContextResolver;
  db?: PrismaClient;
}

/**
 * The only path to organizational truth (Sprint 8 review, item 3) — an
 * explicit OWNER action, never automatic. See server/knowledge/promotion.ts
 * for the supersede/auto-reject side effects this triggers.
 */
export function promoteCandidateHandler(
  rawInput: unknown,
  dependencies: CandidateReviewDependencies = {},
): Promise<ApplicationResult<PromoteCandidateResult>> {
  return toApplicationResult(async () => {
    const db = dependencies.db ?? prisma;
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    assertKnowledgeIngestionAccess(user);
    const input = parseOrThrow(promoteCandidateSchema, rawInput);

    return promoteCandidate(input.candidateId, user.businessId, user.id, db);
  });
}

export function rejectCandidateHandler(
  rawInput: unknown,
  dependencies: CandidateReviewDependencies = {},
): Promise<ApplicationResult<{ candidateId: string }>> {
  return toApplicationResult(async () => {
    const db = dependencies.db ?? prisma;
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    assertKnowledgeIngestionAccess(user);
    const input = parseOrThrow(rejectCandidateSchema, rawInput);

    return rejectCandidate(input.candidateId, user.businessId, user.id, input.rejectionReason, db);
  });
}
