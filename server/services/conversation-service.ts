import { prisma } from "@/server/db/client";
import { Prisma } from "@/server/db/generated/client";
import type { ConversationEntryMessageType, EntryDirection, PrismaClient } from "@/server/db/generated/client";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";
import type { ConversationInput } from "@/lib/validations/conversation";
import { assertLeadBelongsToBusiness } from "./lead-service";

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
) {
  const existing = await db.conversation.findFirst({
    where: { businessId, leadId, channel: "WHATSAPP" },
    orderBy: { lastEntryAt: "desc" },
  });
  if (existing) return existing;

  return db.conversation.create({
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
