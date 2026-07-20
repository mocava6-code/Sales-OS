import "server-only";

import { prisma } from "@/server/db/client";
import { Prisma } from "@/server/db/generated/client";
import type { PrismaClient } from "@/server/db/generated/client";
import type { AuthorizedConversation } from "@/server/application/access-control";
import { buildEngineInputFromConversation } from "@/server/application/analyze-conversation-input";
import { getAIProvider, getTransactionRunner } from "@/server/application/composition-root";
import { analyzeConversationAndCreateDecisions } from "@/server/orchestration/analyze-conversation-and-create-decisions";
import type {
  AnalyzeConversationAndCreateDecisionsInput,
  AnalyzeConversationAndCreateDecisionsResult,
} from "@/server/orchestration/types";
import { findOrCreateLeadByPhone } from "@/server/services/lead-service";
import {
  appendWhatsAppEntry,
  findConversationEntryByExternalId,
  findOrCreateWhatsAppConversation,
  type WhatsAppEntryInput,
} from "@/server/services/conversation-service";
import { UnknownPhoneNumberError } from "./errors";
import {
  applyStatusUpdate as applyStatusUpdateDefault,
  enqueuePendingMessage as enqueuePendingMessageDefault,
  type EnqueuePendingMessageInput,
} from "./queue";
import type { NormalizedWhatsAppMessage, NormalizedWhatsAppStatus } from "./types";

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
  findOrCreateConversation?: (businessId: string, leadId: string, whatsappPhoneNumberId: string) => Promise<{ id: string }>;
  findEntryByExternalId?: (externalId: string) => Promise<{ id: string } | null>;
  appendEntry?: (conversationId: string, entry: WhatsAppEntryInput) => Promise<{ id: string }>;
  loadConversationForAnalysis?: (conversationId: string) => Promise<Pick<AuthorizedConversation, "channel" | "entries">>;
  runAnalysis?: (input: AnalyzeConversationAndCreateDecisionsInput) => Promise<AnalyzeConversationAndCreateDecisionsResult>;
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
    appendEntry:
      overrides.appendEntry ?? ((conversationId: string, entry: WhatsAppEntryInput) => appendWhatsAppEntry(conversationId, entry, db)),
    loadConversationForAnalysis:
      overrides.loadConversationForAnalysis ?? ((conversationId: string) => defaultLoadConversationForAnalysis(conversationId, db)),
    runAnalysis: overrides.runAnalysis ?? defaultRunAnalysis,
    applyStatusUpdate: overrides.applyStatusUpdate ?? ((input: Parameters<typeof applyStatusUpdateDefault>[0]) => applyStatusUpdateDefault(input, db)),
    enqueueMessage: overrides.enqueueMessage ?? ((input: EnqueuePendingMessageInput) => enqueuePendingMessageDefault(input, db)),
  };

  return {
    async handleInboundMessage(message: NormalizedWhatsAppMessage): Promise<InboundMessageResult> {
      // Idempotency first, before any other lookup — duplicate events must
      // safely exit as cheaply as possible.
      const existingEntry = await deps.findEntryByExternalId(message.externalId);
      if (existingEntry) {
        return { duplicate: true, analysisTriggered: false };
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
          return { duplicate: true, analysisTriggered: false };
        }
        throw error;
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
