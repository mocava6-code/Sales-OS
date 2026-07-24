import "server-only";

import { prisma } from "@/server/db/client";
import { Prisma } from "@/server/db/generated/client";
import type { PrismaClient } from "@/server/db/generated/client";
import type { AuthorizedConversation } from "@/server/application/access-control";
import { buildEngineInputFromConversation } from "@/server/application/analyze-conversation-input";
import { getAIProvider, getTransactionRunner } from "@/server/application/composition-root";
import type { DomainEvent } from "@/server/domain-events/types";
import { analyzeConversationAndCreateDecisions } from "@/server/orchestration/analyze-conversation-and-create-decisions";
import { recordDomainEvent as recordDomainEventDefault } from "@/server/orchestration/record-domain-event";
import type {
  AnalyzeConversationAndCreateDecisionsInput,
  AnalyzeConversationAndCreateDecisionsResult,
} from "@/server/orchestration/types";
import type { RecordDomainEventInput, RecordDomainEventResult } from "@/server/orchestration/record-domain-event";
import { PrismaTransactionRunner } from "@/server/persistence/prisma/prisma-transaction-runner";
import { findOrCreateLeadByPhone } from "@/server/services/lead-service";
import {
  appendWhatsAppEntry,
  findConversationEntryByExternalId,
  findOrCreateWhatsAppConversation,
  type FindOrCreateWhatsAppConversationResult,
  type WhatsAppEntryInput,
} from "@/server/services/conversation-service";
import { UnknownPhoneNumberError } from "./errors";
import {
  applyStatusUpdate as applyStatusUpdateDefault,
  enqueuePendingMessage as enqueuePendingMessageDefault,
  type EnqueuePendingMessageInput,
} from "./queue";
import type { NormalizedWhatsAppMessage, NormalizedWhatsAppStatus } from "./types";

/** The conversation entry fields the gateway needs to know about "what happened right before this message" — see MessageReceivedEvent.previousEntry. */
export interface PreviousEntryRecord {
  direction: "INBOUND" | "OUTBOUND";
  occurredAt: Date;
}

// The gateway owns every Meta-specific concern: it's the only place that
// translates a NormalizedWhatsAppMessage/NormalizedWhatsAppStatus into calls
// against the CRM service layer, the outbound queue, and orchestration.
// It never imports from server/intelligence/** — analyzeConversationAndCreateDecisions
// (server/orchestration/**) is the only "decision-adjacent" thing it calls,
// and orchestration itself is completely unaware this gateway exists.

export interface WhatsAppPhoneNumberRecord {
  id: string;
  businessId: string;
  phoneNumberId: string;
}

export interface InboundMessageResult {
  duplicate: boolean;
  businessId?: string;
  leadId?: string;
  conversationId?: string;
  entryId?: string;
  advisorUserId?: string | null;
  analysisTriggered: boolean;
  /** Set when orchestration failed — never thrown, since a webhook must still ack quickly. */
  analysisError?: unknown;
  /** Observer Mode v1 — whether every applicable DomainEvent for this message was recorded. */
  observationsRecorded: boolean;
  /** Set when recording a domain event failed — never thrown, same best-effort contract as analysisError. */
  observationError?: unknown;
}

export interface StatusEventResult {
  /** False when the externalId is unknown to us or the event was a duplicate — both are safe no-ops. */
  applied: boolean;
}

export interface EnqueueOutboundMessageInput {
  businessId: string;
  conversationId: string;
  whatsappPhoneNumberId: string;
  toPhoneNumber: string;
  body: string;
  decisionRecordId?: string;
  createdByUserId?: string;
}

export interface WhatsAppGateway {
  handleInboundMessage(message: NormalizedWhatsAppMessage): Promise<InboundMessageResult>;
  handleStatusEvent(status: NormalizedWhatsAppStatus): Promise<StatusEventResult>;
  enqueueOutboundMessage(input: EnqueueOutboundMessageInput): Promise<{ id: string }>;
}

export interface WhatsAppGatewayDependencies {
  findPhoneNumberByPhoneNumberId?: (phoneNumberId: string) => Promise<WhatsAppPhoneNumberRecord | null>;
  findOrCreateLead?: (
    businessId: string,
    phone: string,
  ) => Promise<{ id: string; assignedToUserId: string | null }>;
  findOrCreateConversation?: (
    businessId: string,
    leadId: string,
    whatsappPhoneNumberId: string,
  ) => Promise<FindOrCreateWhatsAppConversationResult>;
  findEntryByExternalId?: (externalId: string) => Promise<{ id: string } | null>;
  /** The conversation's most recent entry *before* the one about to be appended, if any — feeds MessageReceivedEvent.previousEntry (CUSTOMER_GHOSTED detection). */
  findLatestEntry?: (conversationId: string) => Promise<PreviousEntryRecord | null>;
  appendEntry?: (conversationId: string, entry: WhatsAppEntryInput) => Promise<{ id: string }>;
  loadConversationForAnalysis?: (conversationId: string) => Promise<Pick<AuthorizedConversation, "channel" | "entries">>;
  runAnalysis?: (input: AnalyzeConversationAndCreateDecisionsInput) => Promise<AnalyzeConversationAndCreateDecisionsResult>;
  /** Observer Mode v1 — best-effort, never allowed to fail the underlying WhatsApp write it's describing. */
  recordDomainEvent?: (input: RecordDomainEventInput) => Promise<RecordDomainEventResult>;
  applyStatusUpdate?: (input: {
    externalId: string;
    status: NormalizedWhatsAppStatus["status"];
    occurredAt: Date;
    errorCode?: string;
    errorMessage?: string;
    rawPayload?: unknown;
  }) => Promise<unknown>;
  enqueueMessage?: (input: EnqueuePendingMessageInput) => Promise<{ id: string }>;
}

async function defaultFindPhoneNumberByPhoneNumberId(
  phoneNumberId: string,
  db: PrismaClient,
): Promise<WhatsAppPhoneNumberRecord | null> {
  const record = await db.whatsAppPhoneNumber.findUnique({ where: { phoneNumberId } });
  return record ? { id: record.id, businessId: record.businessId, phoneNumberId: record.phoneNumberId } : null;
}

async function defaultLoadConversationForAnalysis(
  conversationId: string,
  db: PrismaClient,
): Promise<Pick<AuthorizedConversation, "channel" | "entries">> {
  return db.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { entries: { orderBy: { occurredAt: "asc" } } },
  });
}

function defaultRunAnalysis(
  input: AnalyzeConversationAndCreateDecisionsInput,
): Promise<AnalyzeConversationAndCreateDecisionsResult> {
  return analyzeConversationAndCreateDecisions(input, {
    aiProvider: getAIProvider(),
    transactionRunner: getTransactionRunner(),
  });
}

async function defaultFindLatestEntry(conversationId: string, db: PrismaClient): Promise<PreviousEntryRecord | null> {
  const entry = await db.conversationEntry.findFirst({
    where: { conversationId },
    orderBy: { occurredAt: "desc" },
  });
  return entry ? { direction: entry.direction, occurredAt: entry.occurredAt } : null;
}

/**
 * Bound to the same `db` every other default in this factory uses — never
 * the composition-root's cached singleton — so that createWhatsAppGateway(overrides, db)
 * called with a test PrismaClient (see gateway.db.test.ts) never reaches
 * the app's real DATABASE_URL for Observer Mode's writes either.
 */
function defaultRecordDomainEvent(input: RecordDomainEventInput, db: PrismaClient): Promise<RecordDomainEventResult> {
  return recordDomainEventDefault(input, { transactionRunner: new PrismaTransactionRunner(db) });
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Builds a WhatsAppGateway. Every dependency defaults to the real
 * implementation bound to `db` (the app's shared Prisma singleton unless
 * overridden — same injectable-db reasoning as every Prisma*Repository);
 * per-function overrides exist purely for deterministic tests (see
 * server/whatsapp/__tests__/gateway.test.ts, gateway.db.test.ts).
 * Production code should call createWhatsAppGateway() with no arguments.
 */
export function createWhatsAppGateway(overrides: WhatsAppGatewayDependencies = {}, db: PrismaClient = prisma): WhatsAppGateway {
  const deps = {
    findPhoneNumberByPhoneNumberId:
      overrides.findPhoneNumberByPhoneNumberId ?? ((phoneNumberId: string) => defaultFindPhoneNumberByPhoneNumberId(phoneNumberId, db)),
    findOrCreateLead: overrides.findOrCreateLead ?? ((businessId: string, phone: string) => findOrCreateLeadByPhone(businessId, phone, db)),
    findOrCreateConversation:
      overrides.findOrCreateConversation ??
      ((businessId: string, leadId: string, whatsappPhoneNumberId: string) =>
        findOrCreateWhatsAppConversation(businessId, leadId, whatsappPhoneNumberId, db)),
    findEntryByExternalId: overrides.findEntryByExternalId ?? ((externalId: string) => findConversationEntryByExternalId(externalId, db)),
    findLatestEntry: overrides.findLatestEntry ?? ((conversationId: string) => defaultFindLatestEntry(conversationId, db)),
    appendEntry:
      overrides.appendEntry ?? ((conversationId: string, entry: WhatsAppEntryInput) => appendWhatsAppEntry(conversationId, entry, db)),
    loadConversationForAnalysis:
      overrides.loadConversationForAnalysis ?? ((conversationId: string) => defaultLoadConversationForAnalysis(conversationId, db)),
    runAnalysis: overrides.runAnalysis ?? defaultRunAnalysis,
    recordDomainEvent: overrides.recordDomainEvent ?? ((input: RecordDomainEventInput) => defaultRecordDomainEvent(input, db)),
    applyStatusUpdate: overrides.applyStatusUpdate ?? ((input: Parameters<typeof applyStatusUpdateDefault>[0]) => applyStatusUpdateDefault(input, db)),
    enqueueMessage: overrides.enqueueMessage ?? ((input: EnqueuePendingMessageInput) => enqueuePendingMessageDefault(input, db)),
  };

  return {
    async handleInboundMessage(message: NormalizedWhatsAppMessage): Promise<InboundMessageResult> {
      // Idempotency first, before any other lookup — duplicate events must
      // safely exit as cheaply as possible.
      const existingEntry = await deps.findEntryByExternalId(message.externalId);
      if (existingEntry) {
        return { duplicate: true, analysisTriggered: false, observationsRecorded: false };
      }

      // 1-2. Identify business + connected WhatsApp number.
      const phoneNumber = await deps.findPhoneNumberByPhoneNumberId(message.phoneNumberId);
      if (!phoneNumber) {
        throw new UnknownPhoneNumberError(message.phoneNumberId);
      }

      // 3. Identify customer.
      const lead = await deps.findOrCreateLead(phoneNumber.businessId, message.fromPhoneNumber);

      // 4. Locate or create conversation.
      const conversation = await deps.findOrCreateConversation(phoneNumber.businessId, lead.id, phoneNumber.id);

      // Snapshot "what was here before" ahead of the write below — this is
      // the previousEntry Observer Mode's CUSTOMER_GHOSTED detection needs
      // (see server/domain-events/types.ts). Read before insert so it never
      // sees the row about to be appended.
      const previousEntry = await deps.findLatestEntry(conversation.id);

      // 5-6. Persist message + update conversation (one write in appendWhatsAppEntry).
      let entry: { id: string };
      try {
        entry = await deps.appendEntry(conversation.id, {
          direction: "INBOUND",
          content: message.content,
          messageType: message.messageType,
          occurredAt: message.occurredAt,
          externalId: message.externalId,
          mediaId: message.media?.mediaId,
          mediaMimeType: message.media?.mimeType,
          mediaFilename: message.media?.filename,
          mediaSizeBytes: message.media?.sizeBytes,
          mediaCaption: message.media?.caption,
          quotedExternalId: message.quotedExternalId,
          rawPayload: message.raw,
        });
      } catch (error) {
        // Two concurrent deliveries of the same wamid raced past the check
        // above — the unique constraint is the real backstop.
        if (isUniqueConstraintViolation(error)) {
          return { duplicate: true, analysisTriggered: false, observationsRecorded: false };
        }
        throw error;
      }

      // Observer Mode v1 — record CONVERSATION_CREATED (if this thread is
      // new), MESSAGE_RECEIVED, and (when the message carries media)
      // ATTACHMENT_RECEIVED. Best-effort: never blocks the write above or
      // the webhook's fast ack, same contract as analysisError below.
      let observationsRecorded = false;
      let observationError: unknown;
      try {
        if (conversation.created) {
          const conversationCreatedEvent: DomainEvent = {
            type: "CONVERSATION_CREATED",
            businessId: phoneNumber.businessId,
            conversationId: conversation.id,
            leadId: lead.id,
            channel: "WHATSAPP",
            source: "WHATSAPP_SYNCED",
            occurredAt: message.occurredAt,
          };
          await deps.recordDomainEvent({ event: conversationCreatedEvent });
        }

        const messageReceivedEvent: DomainEvent = {
          type: "MESSAGE_RECEIVED",
          businessId: phoneNumber.businessId,
          conversationId: conversation.id,
          conversationEntryId: entry.id,
          messageType: message.messageType,
          content: message.content,
          externalId: message.externalId,
          occurredAt: message.occurredAt,
          previousEntry: previousEntry ?? undefined,
        };
        await deps.recordDomainEvent({ event: messageReceivedEvent, conversationEntryId: entry.id });

        if (message.media) {
          const attachmentReceivedEvent: DomainEvent = {
            type: "ATTACHMENT_RECEIVED",
            businessId: phoneNumber.businessId,
            conversationId: conversation.id,
            conversationEntryId: entry.id,
            mediaType: message.messageType,
            mimeType: message.media.mimeType,
            caption: message.media.caption,
            occurredAt: message.occurredAt,
          };
          await deps.recordDomainEvent({ event: attachmentReceivedEvent, conversationEntryId: entry.id });
        }

        observationsRecorded = true;
      } catch (error) {
        observationError = error;
      }

      // 7. Trigger analyzeConversationAndCreateDecisions() — orchestration is
      // unchanged; failures are caught (never thrown) so the webhook can
      // still ack quickly, but surfaced in the result for logging/tests.
      let analysisTriggered = false;
      let analysisError: unknown;
      try {
        const fullConversation = await deps.loadConversationForAnalysis(conversation.id);
        const engineInput = buildEngineInputFromConversation(phoneNumber.businessId, fullConversation);
        await deps.runAnalysis({
          businessId: phoneNumber.businessId,
          conversationId: conversation.id,
          conversationIntelligenceInput: engineInput,
        });
        analysisTriggered = true;
      } catch (error) {
        analysisError = error;
      }

      return {
        duplicate: false,
        businessId: phoneNumber.businessId,
        leadId: lead.id,
        conversationId: conversation.id,
        entryId: entry.id,
        advisorUserId: lead.assignedToUserId,
        analysisTriggered,
        analysisError,
        observationsRecorded,
        observationError,
      };
    },

    async handleStatusEvent(status: NormalizedWhatsAppStatus): Promise<StatusEventResult> {
      const event = await deps.applyStatusUpdate({
        externalId: status.externalId,
        status: status.status,
        occurredAt: status.occurredAt,
        errorCode: status.errorCode,
        errorMessage: status.errorMessage,
        rawPayload: status.raw,
      });
      return { applied: event !== null };
    },

    async enqueueOutboundMessage(input: EnqueueOutboundMessageInput) {
      return deps.enqueueMessage(input);
    },
  };
}
