import { prisma } from "@/server/db/client";
import { Prisma } from "@/server/db/generated/client";
import type { ConversationEntryMessageType, EntryDirection, PrismaClient } from "@/server/db/generated/client";
import {
  recordDomainEvent as recordDomainEventDefault,
  type RecordDomainEventInput,
  type RecordDomainEventResult,
} from "@/server/orchestration/record-domain-event";
import { PrismaTransactionRunner } from "@/server/persistence/prisma/prisma-transaction-runner";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";
import type { ConversationInput } from "@/lib/validations/conversation";
import { assertLeadBelongsToBusiness } from "./lead-service";

/**
 * Bound to the same `db` the caller passed in — never a composition-root
 * singleton — same reasoning as server/whatsapp/gateway.ts's/sender.ts's
 * defaultRecordDomainEvent. The cast is safe for the same reason as
 * sender.ts's: closeConversation is never called with an existing
 * Prisma.TransactionClient in this codebase.
 */
function defaultRecordDomainEvent(input: RecordDomainEventInput, db: PrismaClientOrTransaction): Promise<RecordDomainEventResult> {
  return recordDomainEventDefault(input, { transactionRunner: new PrismaTransactionRunner(db as PrismaClient) });
}

export async function listUnansweredConversations(businessId: string) {
  return prisma.conversation.findMany({
    where: {
      businessId,
      lastEntryDirection: "INBOUND",
      status: { not: "CLOSED" },
    },
    include: { lead: true },
    orderBy: { lastEntryAt: "asc" },
  });
}

export interface FindOrCreateWhatsAppConversationResult {
  id: string;
  /** Lets the caller (server/whatsapp/gateway.ts) know whether to emit a CONVERSATION_CREATED domain event. */
  created: boolean;
}

/**
 * "Locate or create conversation" for an inbound WhatsApp message
 * (server/whatsapp/gateway.ts). Reuses the most recent WHATSAPP-channel
 * conversation for this lead regardless of status — a customer messaging
 * again continues the same thread even if an advisor had marked it CLOSED;
 * there's no WhatsApp-side concept of a closed thread to mirror.
 */
export async function findOrCreateWhatsAppConversation(
  businessId: string,
  leadId: string,
  whatsappPhoneNumberId: string,
  db: PrismaClientOrTransaction = prisma,
): Promise<FindOrCreateWhatsAppConversationResult> {
  const existing = await db.conversation.findFirst({
    where: { businessId, leadId, channel: "WHATSAPP" },
    orderBy: { lastEntryAt: "desc" },
  });
  if (existing) return { id: existing.id, created: false };

  const created = await db.conversation.create({
    data: {
      businessId,
      leadId,
      channel: "WHATSAPP",
      source: "WHATSAPP_SYNCED",
      status: "NEEDS_REPLY",
      lastEntryAt: new Date(),
      lastEntryDirection: "INBOUND",
      // No human creator — see Conversation.createdByUserId's doc comment.
      createdByUserId: null,
      whatsappPhoneNumberId,
    },
  });
  return { id: created.id, created: true };
}

export interface WhatsAppEntryInput {
  direction: EntryDirection;
  content: string;
  messageType: ConversationEntryMessageType;
  occurredAt: Date;
  externalId: string;
  mediaId?: string;
  mediaMimeType?: string;
  mediaFilename?: string;
  mediaSizeBytes?: number;
  mediaCaption?: string;
  quotedExternalId?: string;
  rawPayload?: unknown;
}

/**
 * Idempotency lookup for inbound WhatsApp ingestion — callers (the gateway)
 * check this before appendWhatsAppEntry so a re-delivered webhook safely
 * exits instead of writing a duplicate entry. The unique constraint on
 * externalId is the backstop for the race this check alone can't close.
 */
export async function findConversationEntryByExternalId(externalId: string, db: PrismaClientOrTransaction = prisma) {
  return db.conversationEntry.findUnique({ where: { externalId } });
}

/**
 * "Persist message" + "update conversation" (steps 5-6 of WhatsApp
 * ingestion) as one write — the conversation's lastEntryAt/lastEntryDirection/
 * status always reflect the entry just appended, never a stale prior one.
 * Takes a full PrismaClient (not PrismaClientOrTransaction) since the
 * array-form $transaction it uses isn't available on a transaction client.
 */
export async function appendWhatsAppEntry(conversationId: string, entry: WhatsAppEntryInput, db: PrismaClient = prisma) {
  const [createdEntry] = await db.$transaction([
    db.conversationEntry.create({
      data: {
        conversationId,
        direction: entry.direction,
        content: entry.content,
        messageType: entry.messageType,
        occurredAt: entry.occurredAt,
        externalId: entry.externalId,
        mediaId: entry.mediaId,
        mediaMimeType: entry.mediaMimeType,
        mediaFilename: entry.mediaFilename,
        mediaSizeBytes: entry.mediaSizeBytes,
        mediaCaption: entry.mediaCaption,
        quotedExternalId: entry.quotedExternalId,
        rawPayload: entry.rawPayload === undefined ? Prisma.DbNull : (entry.rawPayload as Prisma.InputJsonValue),
      },
    }),
    db.conversation.update({
      where: { id: conversationId },
      data: {
        lastEntryAt: entry.occurredAt,
        lastEntryDirection: entry.direction,
        status: entry.direction === "INBOUND" ? "NEEDS_REPLY" : "WAITING_ON_CUSTOMER",
      },
    }),
  ]);

  return createdEntry;
}

export async function logConversation(
  businessId: string,
  createdByUserId: string,
  input: ConversationInput,
) {
  // Re-verify the lead belongs to this tenant before writing anything —
  // input.leadId came from a form and is never trusted on its own.
  await assertLeadBelongsToBusiness(businessId, input.leadId);

  const now = new Date();
  const lastEntry = input.entries[input.entries.length - 1];

  return prisma.conversation.create({
    data: {
      businessId,
      leadId: input.leadId,
      channel: "WHATSAPP",
      source: input.entries.length > 1 ? "MANUAL_ENTRY" : "MANUAL_PASTE",
      status: lastEntry.direction === "INBOUND" ? "NEEDS_REPLY" : "WAITING_ON_CUSTOMER",
      lastEntryAt: now,
      lastEntryDirection: lastEntry.direction,
      createdByUserId,
      entries: {
        // Offset by index so occurredAt preserves the order the entries
        // were logged in, even though they're all saved in one request.
        create: input.entries.map((entry, index) => ({
          direction: entry.direction,
          content: entry.content,
          occurredAt: new Date(now.getTime() + index),
        })),
      },
    },
  });
}

export interface CloseConversationDependencies {
  /** Observer Mode v1 — best-effort, never allowed to fail the close itself. */
  recordDomainEvent?: (input: RecordDomainEventInput) => Promise<RecordDomainEventResult>;
}

/**
 * No caller exists yet — the CLOSED status value has been in the schema
 * unused since WhatsApp Business Integration v1 (see
 * ConversationStatus.CLOSED's doc comment), and there's still no "close
 * conversation" UI/action in this sprint. This function is the trigger
 * point CUSTOMER_GHOSTED detection needs once one is built: it closes the
 * conversation and records a CONVERSATION_CLOSED domain event so the
 * Observation Engine can flag an advisor's unanswered last message.
 */
export async function closeConversation(
  conversationId: string,
  db: PrismaClientOrTransaction = prisma,
  dependencies: CloseConversationDependencies = {},
) {
  const conversation = await db.conversation.update({
    where: { id: conversationId },
    data: { status: "CLOSED" },
  });

  const recordDomainEvent = dependencies.recordDomainEvent ?? ((input: RecordDomainEventInput) => defaultRecordDomainEvent(input, db));
  try {
    await recordDomainEvent({
      event: {
        type: "CONVERSATION_CLOSED",
        businessId: conversation.businessId,
        conversationId: conversation.id,
        lastEntryDirection: conversation.lastEntryDirection,
        lastEntryAt: conversation.lastEntryAt,
        occurredAt: new Date(),
      },
    });
  } catch {
    // Swallowed deliberately — see CloseConversationDependencies doc comment.
  }

  return conversation;
}
