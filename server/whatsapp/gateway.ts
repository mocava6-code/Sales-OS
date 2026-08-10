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
import { projectLeadCommercialProfile, type ProjectLeadCommercialProfileResult } from "@/server/services/lead-commercial-profile-service";
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
import type { NormalizedWhatsAppBusinessAppMessage, NormalizedWhatsAppMessage, NormalizedWhatsAppStatus } from "./types";

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
  /** Kori Natural Language Analytics v0 Phase 1 — whether LeadCommercialProfile was (re)projected. Only attempted when analysisTriggered. */
  profileProjected: boolean;
  /** Set when projection failed — never thrown, same best-effort contract as analysisError/observationError. */
  profileProjectionError?: unknown;
}

export interface StatusEventResult {
  /** False when the externalId is unknown to us or the event was a duplicate — both are safe no-ops. */
  applied: boolean;
}

export interface BusinessAppEchoResult {
  duplicate: boolean;
  /** True for edit/revoke items in v1 — recognized but not persisted, see handleBusinessAppEchoEvent's doc comment. */
  ignored?: boolean;
  businessId?: string;
  leadId?: string;
  conversationId?: string;
  entryId?: string;
  observationsRecorded: boolean;
  observationError?: unknown;
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
  handleBusinessAppEchoEvent(message: NormalizedWhatsAppBusinessAppMessage): Promise<BusinessAppEchoResult>;
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
  /** Kori Natural Language Analytics v0 Phase 1 — best-effort, same contract as runAnalysis/recordDomainEvent. */
  projectCommercialProfile?: (businessId: string, leadId: string) => Promise<ProjectLeadCommercialProfileResult>;
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
    projectCommercialProfile:
      overrides.projectCommercialProfile ?? ((businessId: string, leadId: string) => projectLeadCommercialProfile(businessId, leadId, db)),
    applyStatusUpdate: overrides.applyStatusUpdate ?? ((input: Parameters<typeof applyStatusUpdateDefault>[0]) => applyStatusUpdateDefault(input, db)),
    enqueueMessage: overrides.enqueueMessage ?? ((input: EnqueuePendingMessageInput) => enqueuePendingMessageDefault(input, db)),
  };

  return {
    async handleInboundMessage(message: NormalizedWhatsAppMessage): Promise<InboundMessageResult> {
      // Idempotency first, before any other lookup — duplicate events must
      // safely exit as cheaply as possible.
      const existingEntry = await deps.findEntryByExternalId(message.externalId);
      if (existingEntry) {
        return { duplicate: true, analysisTriggered: false, observationsRecorded: false, profileProjected: false };
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
          return { duplicate: true, analysisTriggered: false, observationsRecorded: false, profileProjected: false };
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

      // 8. Kori Natural Language Analytics v0 Phase 1 — best-effort projection
      // of LeadCommercialProfile from the newest available commercial facts.
      // Only attempted after a successful analysis run (no point projecting
      // off a stale/absent snapshot otherwise) — but the projection itself
      // independently reads the latest snapshot rather than depending on
      // this turn's specific output, so it's safe even when nothing changed.
      let profileProjected = false;
      let profileProjectionError: unknown;
      if (analysisTriggered) {
        try {
          await deps.projectCommercialProfile(phoneNumber.businessId, lead.id);
          profileProjected = true;
        } catch (error) {
          profileProjectionError = error;
        }
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
        profileProjected,
        profileProjectionError,
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

    /**
     * Coexistence only — a message the business sent from the WhatsApp
     * Business app or a linked device, mirrored via smb_message_echoes.
     * Reuses the exact same lead/conversation/domain-event machinery as
     * handleInboundMessage above, just persisted as OUTBOUND instead of
     * INBOUND. Does not trigger analyzeConversationAndCreateDecisions —
     * Kori's engine only ever reacts to inbound customer messages today;
     * running it off an agent's own outgoing text is a product decision
     * for a later phase, not a mechanical extension of this one.
     *
     * EDIT/REVOKE items are recognized but deliberately not persisted:
     * ConversationEntry is append-only everywhere else in this codebase,
     * and retrofitting in-place mutation is a real schema/behavior change,
     * not an additive one. TODO(coexistence-v2): if edit/revoke support is
     * wanted, add explicit nullable columns (e.g. editedContent, revokedAt)
     * and a dedicated update path — reviewed separately, not bundled here.
     */
    async handleBusinessAppEchoEvent(message: NormalizedWhatsAppBusinessAppMessage): Promise<BusinessAppEchoResult> {
      if (message.subtype === "EDIT" || message.subtype === "REVOKE") {
        return { duplicate: false, ignored: true, observationsRecorded: false };
      }

      // Same idempotency check handleInboundMessage uses, on the same
      // ConversationEntry.externalId space — this is what stops a message
      // Sales OS already sent via Cloud API (server/whatsapp/sender.ts,
      // which sets externalId from the Graph API response) from ever being
      // persisted a second time if it were ever echoed back: whichever path
      // wrote the entry first wins, and the second path just observes it
      // already exists. In practice Meta only echoes app/linked-device
      // sends, never Cloud API sends, so this doubles as a defensive
      // backstop rather than the primary mechanism.
      const existingEntry = await deps.findEntryByExternalId(message.externalId);
      if (existingEntry) {
        return { duplicate: true, observationsRecorded: false };
      }

      const phoneNumber = await deps.findPhoneNumberByPhoneNumberId(message.phoneNumberId);
      if (!phoneNumber) {
        throw new UnknownPhoneNumberError(message.phoneNumberId);
      }

      const lead = await deps.findOrCreateLead(phoneNumber.businessId, message.toPhoneNumber);
      const conversation = await deps.findOrCreateConversation(phoneNumber.businessId, lead.id, phoneNumber.id);

      let entry: { id: string };
      try {
        entry = await deps.appendEntry(conversation.id, {
          direction: "OUTBOUND",
          content: message.content,
          messageType: message.messageType,
          occurredAt: message.occurredAt,
          externalId: message.externalId,
          rawPayload: message.raw,
        });
      } catch (error) {
        // Same race as handleInboundMessage's identical catch below it.
        if (isUniqueConstraintViolation(error)) {
          return { duplicate: true, observationsRecorded: false };
        }
        throw error;
      }

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

        const messageSentEvent: DomainEvent = {
          type: "MESSAGE_SENT",
          businessId: phoneNumber.businessId,
          conversationId: conversation.id,
          conversationEntryId: entry.id,
          content: message.content,
          externalId: message.externalId,
          occurredAt: message.occurredAt,
        };
        await deps.recordDomainEvent({ event: messageSentEvent, conversationEntryId: entry.id });

        observationsRecorded = true;
      } catch (error) {
        observationError = error;
      }

      return {
        duplicate: false,
        businessId: phoneNumber.businessId,
        leadId: lead.id,
        conversationId: conversation.id,
        entryId: entry.id,
        observationsRecorded,
        observationError,
      };
    },

    async enqueueOutboundMessage(input: EnqueueOutboundMessageInput) {
      return deps.enqueueMessage(input);
    },
  };
}
