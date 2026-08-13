// Pure, Next.js-free application handlers behind the 4 WhatsApp reply
// server actions in server/actions/whatsapp.ts. Same conventions as
// server/application/decision-actions.ts: authenticate -> validate ->
// construct dependencies -> call the domain layer -> map the result/error,
// strictly in that order so an unauthenticated/malformed request never pays
// for (or surfaces failures from) constructing a sender client it was never
// going to use.
//
// No Meta SDK, no Graph API shape, is ever imported here — only the
// provider-neutral interfaces from server/whatsapp/queue.ts and
// server/whatsapp/sender.ts.

import {
  approveWhatsAppReplySchema,
  importHistoricalWhatsAppChatSchema,
  previewHistoricalImportSchema,
  queueWhatsAppReplySchema,
  registerWhatsAppPhoneNumberSchema,
  rejectWhatsAppReplySchema,
  sendQueuedReplySchema,
} from "@/lib/validations/whatsapp";
import { fetchKnownBusinessNames } from "@/server/application/known-business-names";
import { prisma } from "@/server/db/client";
import type {
  EntryDirection,
  PendingWhatsAppMessage as PendingWhatsAppMessageRow,
  PrismaClient,
  WhatsAppPhoneNumber as WhatsAppPhoneNumberRow,
} from "@/server/db/generated/client";
import type { AIProvider } from "@/server/intelligence/ai-provider";
import { type ImportDateOrder, parseWhatsAppExport } from "@/server/knowledge/whatsapp-import/parser";
import { analyzeConversationAndCreateDecisions } from "@/server/orchestration/analyze-conversation-and-create-decisions";
import { findOrCreateLeadByPhone } from "@/server/services/lead-service";
import {
  importHistoricalEntriesIntoConversation,
  type HistoricalImportEntryInput,
  type ImportHistoricalEntriesResult,
} from "@/server/services/historical-import-service";
import { DuplicatePhoneNumberError } from "@/server/whatsapp/errors";
import { registerWhatsAppPhoneNumber, type RegisterWhatsAppPhoneNumberInput } from "@/server/whatsapp/phone-numbers";
import {
  enqueuePendingMessage,
  markMessageCancelled,
  markMessageReady,
  type EnqueuePendingMessageInput,
} from "@/server/whatsapp/queue";
import { createWhatsAppSenderClientFromEnv, sendReadyMessage, type WhatsAppSenderClient } from "@/server/whatsapp/sender";
import type { z } from "zod";
import {
  type AuthorizedConversationForReply,
  type AuthorizedPendingWhatsAppMessage,
  loadAuthorizedConversationForReply,
  loadAuthorizedPendingMessage,
} from "./access-control";
import { buildEngineInputFromConversation } from "./analyze-conversation-input";
import { type AuthContextResolver, type AuthenticatedUser, defaultAuthContextResolver, requireAuthenticatedUser } from "./auth";
import { getAIProvider, getTransactionRunner } from "./composition-root";
import { toPendingWhatsAppMessageSummaryDTO, toWhatsAppPhoneNumberDTO, type PendingWhatsAppMessageSummaryDTO, type WhatsAppPhoneNumberDTO } from "./dto";
import { type ApplicationResult, ForbiddenError, InvalidInputError, toApplicationResult } from "./errors";

function parseOrThrow<Schema extends z.ZodTypeAny>(schema: Schema, rawInput: unknown): z.infer<Schema> {
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    throw new InvalidInputError(parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}

export interface ActionDependencies {
  resolver?: AuthContextResolver;
}

// --- Queue reply -------------------------------------------------------------

export interface QueueReplyActionDependencies extends ActionDependencies {
  loadConversation?: (user: AuthenticatedUser, conversationId: string) => Promise<AuthorizedConversationForReply>;
  enqueue?: (input: EnqueuePendingMessageInput) => Promise<PendingWhatsAppMessageRow>;
}

export function queueWhatsAppReplyHandler(
  rawInput: unknown,
  dependencies: QueueReplyActionDependencies = {},
): Promise<ApplicationResult<PendingWhatsAppMessageSummaryDTO>> {
  return toApplicationResult(async () => {
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    const input = parseOrThrow(queueWhatsAppReplySchema, rawInput);

    const loadConversation = dependencies.loadConversation ?? loadAuthorizedConversationForReply;
    const enqueue = dependencies.enqueue ?? enqueuePendingMessage;

    const conversation = await loadConversation(user, input.conversationId);
    if (!conversation.whatsappPhoneNumberId) {
      throw new InvalidInputError({ conversationId: ["Esta conversación no tiene un número de WhatsApp asociado."] });
    }

    const message = await enqueue({
      businessId: user.businessId,
      conversationId: conversation.id,
      whatsappPhoneNumberId: conversation.whatsappPhoneNumberId,
      toPhoneNumber: conversation.leadPhone,
      body: input.body,
      decisionRecordId: input.decisionRecordId,
      createdByUserId: user.id,
    });

    return toPendingWhatsAppMessageSummaryDTO(message);
  });
}

// --- Approve / reject ---------------------------------------------------------

export interface PendingMessageActionDependencies extends ActionDependencies {
  loadPendingMessage?: (user: AuthenticatedUser, pendingMessageId: string) => Promise<AuthorizedPendingWhatsAppMessage>;
}

export function approveWhatsAppReplyHandler(
  rawInput: unknown,
  dependencies: PendingMessageActionDependencies & { markReady?: (id: string) => Promise<PendingWhatsAppMessageRow> } = {},
): Promise<ApplicationResult<PendingWhatsAppMessageSummaryDTO>> {
  return toApplicationResult(async () => {
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    const input = parseOrThrow(approveWhatsAppReplySchema, rawInput);

    const loadPendingMessage = dependencies.loadPendingMessage ?? loadAuthorizedPendingMessage;
    const markReady = dependencies.markReady ?? markMessageReady;

    await loadPendingMessage(user, input.pendingMessageId);
    const message = await markReady(input.pendingMessageId);

    return toPendingWhatsAppMessageSummaryDTO(message);
  });
}

export function rejectWhatsAppReplyHandler(
  rawInput: unknown,
  dependencies: PendingMessageActionDependencies & { markCancelled?: (id: string) => Promise<PendingWhatsAppMessageRow> } = {},
): Promise<ApplicationResult<PendingWhatsAppMessageSummaryDTO>> {
  return toApplicationResult(async () => {
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    const input = parseOrThrow(rejectWhatsAppReplySchema, rawInput);

    const loadPendingMessage = dependencies.loadPendingMessage ?? loadAuthorizedPendingMessage;
    const markCancelled = dependencies.markCancelled ?? markMessageCancelled;

    await loadPendingMessage(user, input.pendingMessageId);
    const message = await markCancelled(input.pendingMessageId);

    return toPendingWhatsAppMessageSummaryDTO(message);
  });
}

// --- Send queued reply ---------------------------------------------------------

export interface SendQueuedReplyActionDependencies extends ActionDependencies {
  loadPendingMessage?: (user: AuthenticatedUser, pendingMessageId: string) => Promise<AuthorizedPendingWhatsAppMessage>;
  senderClient?: WhatsAppSenderClient;
  sendReady?: (
    pendingMessageId: string,
    deps: { client: WhatsAppSenderClient },
  ) => Promise<PendingWhatsAppMessageRow>;
}

export function sendQueuedReplyHandler(
  rawInput: unknown,
  dependencies: SendQueuedReplyActionDependencies = {},
): Promise<ApplicationResult<PendingWhatsAppMessageSummaryDTO>> {
  return toApplicationResult(async () => {
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    const input = parseOrThrow(sendQueuedReplySchema, rawInput);

    const loadPendingMessage = dependencies.loadPendingMessage ?? loadAuthorizedPendingMessage;
    await loadPendingMessage(user, input.pendingMessageId);

    // Resolved only after auth + validation + tenant-ownership all pass —
    // no reason to construct a Graph API client for a request that was
    // always going to fail earlier.
    const senderClient = dependencies.senderClient ?? createWhatsAppSenderClientFromEnv();
    const sendReady = dependencies.sendReady ?? sendReadyMessage;

    const message = await sendReady(input.pendingMessageId, { client: senderClient });

    return toPendingWhatsAppMessageSummaryDTO(message);
  });
}

// --- Register phone number ------------------------------------------------

/**
 * Registering a business's WhatsApp number is OWNER-only — same access
 * level as Knowledge ingestion (server/application/knowledge-actions.ts's
 * assertKnowledgeIngestionAccess): a tenant-wide routing config that
 * determines which business every future inbound message resolves to, not
 * a per-conversation action any SALESPERSON should be able to change.
 */
function assertPhoneNumberManagementAccess(user: AuthenticatedUser): void {
  if (user.role !== "OWNER") {
    throw new ForbiddenError("Solo el propietario del negocio puede registrar un número de WhatsApp.");
  }
}

export interface RegisterPhoneNumberActionDependencies extends ActionDependencies {
  register?: (businessId: string, input: RegisterWhatsAppPhoneNumberInput) => Promise<WhatsAppPhoneNumberRow>;
}

export function registerWhatsAppPhoneNumberHandler(
  rawInput: unknown,
  dependencies: RegisterPhoneNumberActionDependencies = {},
): Promise<ApplicationResult<WhatsAppPhoneNumberDTO>> {
  return toApplicationResult(async () => {
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    assertPhoneNumberManagementAccess(user);
    const input = parseOrThrow(registerWhatsAppPhoneNumberSchema, rawInput);

    const register = dependencies.register ?? registerWhatsAppPhoneNumber;

    try {
      const record = await register(user.businessId, input);
      return toWhatsAppPhoneNumberDTO(record);
    } catch (error) {
      // Surfaced as a field error rather than a generic failure — the
      // duplicate is almost always the same number pasted twice, or a
      // number already registered to this or another business.
      if (error instanceof DuplicatePhoneNumberError) {
        throw new InvalidInputError({ phoneNumberId: [error.message] });
      }
      throw error;
    }
  });
}

// --- Historical WhatsApp CRM import ----------------------------------------

/**
 * Same access level as phone-number registration and Knowledge ingestion —
 * a tenant-wide backfill action, not a per-conversation one any SALESPERSON
 * should trigger.
 */
function assertHistoricalImportAccess(user: AuthenticatedUser): void {
  if (user.role !== "OWNER") {
    throw new ForbiddenError("Solo el propietario del negocio puede importar historial de chat de WhatsApp.");
  }
}

// Unsaved WhatsApp contacts show as their own number as the participant
// label — loose enough to catch that so it can be suggested as a starting
// point, never used to silently persist a value the OWNER hasn't seen.
function looksLikePhoneNumber(label: string): boolean {
  return /^\+?[\d\s()-]{7,20}$/.test(label.trim());
}

export type PreviewHistoricalImportResult =
  | { status: "NEEDS_PARTICIPANT_RESOLUTION"; candidateLabels: [string, string] }
  | {
      status: "READY_TO_IMPORT";
      rawText: string;
      dateOrder: ImportDateOrder;
      timezone: string;
      manualBusinessSenderLabel?: string;
      participantLabels: string[];
      suggestedCustomerPhone: string | null;
      messageCount: number;
      unparseableTimestampCount: number;
    };

export interface HistoricalImportActionDependencies extends ActionDependencies {
  db?: PrismaClient;
}

export function previewHistoricalImportHandler(
  rawInput: unknown,
  dependencies: HistoricalImportActionDependencies = {},
): Promise<ApplicationResult<PreviewHistoricalImportResult>> {
  return toApplicationResult(async () => {
    const db = dependencies.db ?? prisma;
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    assertHistoricalImportAccess(user);
    const input = parseOrThrow(previewHistoricalImportSchema, rawInput);

    const knownBusinessNames = await fetchKnownBusinessNames(user.businessId, db);
    const parsed = parseWhatsAppExport({
      rawText: input.rawText,
      dateOrder: input.dateOrder,
      timezone: input.timezone,
      knownBusinessNames,
      manualBusinessSenderLabel: input.manualBusinessSenderLabel,
    });

    if (parsed.needsParticipantResolution) {
      return { status: "NEEDS_PARTICIPANT_RESOLUTION", candidateLabels: parsed.candidateLabels };
    }

    // roleForSender only ever produces BUSINESS/CUSTOMER for an
    // unambiguously-resolved 2-participant chat — anything else (group
    // chats, 3+ participants) makes every message UNKNOWN uniformly.
    // Reject the whole chat here rather than silently importing zero messages.
    if (!parsed.resolution.businessSenderLabel || parsed.participantLabels.length !== 2) {
      throw new InvalidInputError({
        rawText: ["Este chat tiene más de 2 participantes o no se pudo resolver a un par cliente/negocio — no se admiten exportaciones de chats grupales."],
      });
    }

    const customerLabel = parsed.participantLabels.find((label) => label !== parsed.resolution.businessSenderLabel) ?? null;
    const unparseableTimestampCount = parsed.warnings.filter((w) => w.type === "UNPARSEABLE_TIMESTAMP").length;

    return {
      status: "READY_TO_IMPORT",
      rawText: input.rawText,
      dateOrder: input.dateOrder,
      timezone: input.timezone,
      manualBusinessSenderLabel: input.manualBusinessSenderLabel,
      participantLabels: parsed.participantLabels,
      suggestedCustomerPhone: customerLabel && looksLikePhoneNumber(customerLabel) ? customerLabel : null,
      messageCount: parsed.messages.length,
      unparseableTimestampCount,
    };
  });
}

export interface HistoricalImportSummary {
  leadId: string;
  conversationId: string;
  conversationCreated: boolean;
  createdCount: number;
  duplicateCount: number;
  skippedUnparseableTimestampCount: number;
  analysisTriggered: boolean;
}

async function defaultRunHistoricalImportAnalysis(
  businessId: string,
  conversationId: string,
  db: PrismaClient,
  aiProvider: AIProvider | undefined,
): Promise<void> {
  // Mirrors server/whatsapp/gateway.ts's handleInboundMessage step 7
  // exactly, without importing anything from gateway.ts itself — gateway.ts
  // is never touched by this feature.
  const conversation = await db.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { entries: { orderBy: { occurredAt: "asc" } } },
  });
  const engineInput = buildEngineInputFromConversation(businessId, conversation);
  await analyzeConversationAndCreateDecisions(
    { businessId, conversationId, conversationIntelligenceInput: engineInput },
    { aiProvider: aiProvider ?? getAIProvider(), transactionRunner: getTransactionRunner() },
  );
}

export interface ImportHistoricalWhatsAppChatDependencies extends HistoricalImportActionDependencies {
  aiProvider?: AIProvider;
  findOrCreateLead?: (businessId: string, phone: string, db: PrismaClient) => Promise<{ id: string }>;
  importEntries?: (
    businessId: string,
    leadId: string,
    entries: HistoricalImportEntryInput[],
    createdByUserId: string,
    db: PrismaClient,
  ) => Promise<ImportHistoricalEntriesResult>;
  runAnalysis?: (businessId: string, conversationId: string, db: PrismaClient) => Promise<void>;
}

export function importHistoricalWhatsAppChatHandler(
  rawInput: unknown,
  dependencies: ImportHistoricalWhatsAppChatDependencies = {},
): Promise<ApplicationResult<HistoricalImportSummary>> {
  return toApplicationResult(async () => {
    const db = dependencies.db ?? prisma;
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    assertHistoricalImportAccess(user);
    const input = parseOrThrow(importHistoricalWhatsAppChatSchema, rawInput);

    const knownBusinessNames = await fetchKnownBusinessNames(user.businessId, db);
    const parsed = parseWhatsAppExport({
      rawText: input.rawText,
      dateOrder: input.dateOrder,
      timezone: input.timezone,
      knownBusinessNames,
      manualBusinessSenderLabel: input.manualBusinessSenderLabel,
    });

    const findOrCreateLead = dependencies.findOrCreateLead ?? findOrCreateLeadByPhone;
    const importEntries = dependencies.importEntries ?? importHistoricalEntriesIntoConversation;
    const runAnalysis = dependencies.runAnalysis ?? ((businessId, conversationId, runDb) => defaultRunHistoricalImportAnalysis(businessId, conversationId, runDb, dependencies.aiProvider));

    if (parsed.needsParticipantResolution || !parsed.resolution.businessSenderLabel || parsed.participantLabels.length !== 2) {
      // Defense-in-depth — this handler never trusts that a prior preview
      // call happened; the DB write below must never be reachable with an
      // UNKNOWN role still possible for a determinable participant.
      throw new InvalidInputError({ rawText: ["Este chat no se pudo resolver — vuelve a ejecutar el paso de vista previa primero."] });
    }

    const skippedUnparseableTimestampCount = parsed.messages.filter((m) => m.occurredAt === null).length;
    const entries = parsed.messages
      .filter((m) => m.occurredAt !== null && m.resolvedRole !== "UNKNOWN") // hard gate: never persist a null timestamp or an unresolved role
      .map((m) => ({
        direction: (m.resolvedRole === "CUSTOMER" ? "INBOUND" : "OUTBOUND") as EntryDirection,
        content: m.content,
        occurredAt: m.occurredAt as Date,
        sequenceIndex: m.sequenceIndex,
        rawLine: m.rawLine,
      }));

    const lead = await findOrCreateLead(user.businessId, input.phone, db);
    const imported = await importEntries(user.businessId, lead.id, entries, user.id, db);

    let analysisTriggered = false;
    if (input.runAnalysis && imported.conversationId && imported.createdCount > 0) {
      try {
        await runAnalysis(user.businessId, imported.conversationId, db);
        analysisTriggered = true;
      } catch (error) {
        // Best-effort, same contract as gateway.ts's analysisError — the
        // import itself has already succeeded and must not be undone
        // because the optional analysis pass failed.
        console.error(`[historical-import] analysis failed for conversation ${imported.conversationId}, import unaffected:`, error);
      }
    }

    return {
      leadId: lead.id,
      conversationId: imported.conversationId!,
      conversationCreated: imported.conversationCreated,
      createdCount: imported.createdCount,
      duplicateCount: imported.duplicateCount,
      skippedUnparseableTimestampCount,
      analysisTriggered,
    };
  });
}
