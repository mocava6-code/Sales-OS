import "server-only";

import { prisma } from "@/server/db/client";
import { Prisma } from "@/server/db/generated/client";
import type { PendingWhatsAppMessageStatus, WhatsAppMessageStatus } from "@/server/db/generated/client";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";
import { InvalidPendingMessageStatusTransitionError, PendingMessageNotFoundError } from "./errors";

// Kori never sends WhatsApp messages — it only generates recommendations.
// This module owns the PendingWhatsAppMessage queue and its status-transition
// policy; server/whatsapp/sender.ts is the only thing that ever moves a row
// from READY to SENT, and only when explicitly called (no background worker,
// no polling loop).
//
// WAITING_APPROVAL --> READY | CANCELLED
// READY            --> SENT | FAILED | CANCELLED
// SENT, FAILED, CANCELLED are terminal.

const ALLOWED_TRANSITIONS: Readonly<Record<PendingWhatsAppMessageStatus, readonly PendingWhatsAppMessageStatus[]>> = {
  WAITING_APPROVAL: ["READY", "CANCELLED"],
  READY: ["SENT", "FAILED", "CANCELLED"],
  SENT: [],
  FAILED: [],
  CANCELLED: [],
};

export function isPendingMessageStatusTransitionAllowed(
  from: PendingWhatsAppMessageStatus,
  to: PendingWhatsAppMessageStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

function assertTransitionAllowed(from: PendingWhatsAppMessageStatus, to: PendingWhatsAppMessageStatus): void {
  if (!isPendingMessageStatusTransitionAllowed(from, to)) {
    throw new InvalidPendingMessageStatusTransitionError(from, to);
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export interface EnqueuePendingMessageInput {
  businessId: string;
  conversationId: string;
  whatsappPhoneNumberId: string;
  toPhoneNumber: string;
  body: string;
  /** Set when this reply originated from a Kori recommendation the advisor approved. */
  decisionRecordId?: string;
  createdByUserId?: string;
}

/** "Queue reply" — always starts at WAITING_APPROVAL; nothing is ever queued directly as READY. */
export async function enqueuePendingMessage(input: EnqueuePendingMessageInput, db: PrismaClientOrTransaction = prisma) {
  return db.pendingWhatsAppMessage.create({
    data: {
      businessId: input.businessId,
      conversationId: input.conversationId,
      whatsappPhoneNumberId: input.whatsappPhoneNumberId,
      toPhoneNumber: input.toPhoneNumber,
      body: input.body,
      decisionRecordId: input.decisionRecordId,
      createdByUserId: input.createdByUserId,
      status: "WAITING_APPROVAL",
    },
  });
}

export async function findPendingMessageById(id: string, db: PrismaClientOrTransaction = prisma) {
  return db.pendingWhatsAppMessage.findUnique({ where: { id } });
}

export async function findPendingMessageByExternalId(externalId: string, db: PrismaClientOrTransaction = prisma) {
  return db.pendingWhatsAppMessage.findUnique({ where: { externalId } });
}

/** The sender's work queue — every READY row, oldest first, for a business (or across all businesses if omitted). */
export async function listReadyMessages(businessId?: string, db: PrismaClientOrTransaction = prisma) {
  return db.pendingWhatsAppMessage.findMany({
    where: { status: "READY", ...(businessId ? { businessId } : {}) },
    orderBy: { createdAt: "asc" },
  });
}

async function transitionPendingMessage(
  id: string,
  toStatus: PendingWhatsAppMessageStatus,
  extraData: Record<string, unknown>,
  db: PrismaClientOrTransaction,
) {
  const existing = await db.pendingWhatsAppMessage.findUnique({ where: { id } });
  if (!existing) {
    throw new PendingMessageNotFoundError(id);
  }
  assertTransitionAllowed(existing.status, toStatus);

  return db.pendingWhatsAppMessage.update({
    where: { id },
    data: { status: toStatus, ...extraData },
  });
}

/** "Approve reply": WAITING_APPROVAL -> READY. */
export function markMessageReady(id: string, db: PrismaClientOrTransaction = prisma) {
  return transitionPendingMessage(id, "READY", {}, db);
}

/** "Reject reply": WAITING_APPROVAL or READY -> CANCELLED. */
export function markMessageCancelled(id: string, db: PrismaClientOrTransaction = prisma) {
  return transitionPendingMessage(id, "CANCELLED", {}, db);
}

/**
 * READY -> SENT, called only by server/whatsapp/sender.ts after a successful
 * Graph API call. Also records the SENT status event atomically, in the same
 * transaction, so the chronological status history always starts at SENT.
 */
export async function markMessageSent(id: string, externalId: string, db: PrismaClientOrTransaction = prisma) {
  const existing = await db.pendingWhatsAppMessage.findUnique({ where: { id } });
  if (!existing) {
    throw new PendingMessageNotFoundError(id);
  }
  assertTransitionAllowed(existing.status, "SENT");

  const now = new Date();
  const [updated] = await Promise.all([
    db.pendingWhatsAppMessage.update({
      where: { id },
      data: { status: "SENT", externalId, sentAt: now },
    }),
    db.whatsAppMessageStatusEvent.create({
      data: { pendingMessageId: id, status: "SENT", occurredAt: now },
    }),
  ]);

  return updated;
}

/** READY -> FAILED, called by server/whatsapp/sender.ts when the Graph API call itself fails. */
export function markMessageFailed(id: string, failureReason: string, db: PrismaClientOrTransaction = prisma) {
  return transitionPendingMessage(id, "FAILED", { failureReason }, db);
}

export interface RecordStatusEventInput {
  pendingMessageId: string;
  status: WhatsAppMessageStatus;
  occurredAt: Date;
  errorCode?: string;
  errorMessage?: string;
  rawPayload?: unknown;
}

/**
 * Records one delivery-status webhook event. Idempotent: a re-delivered
 * identical status (same pendingMessageId + status) safely exits via the
 * unique constraint instead of duplicating history — returns null rather
 * than throwing.
 */
export async function recordStatusEvent(input: RecordStatusEventInput, db: PrismaClientOrTransaction = prisma) {
  try {
    return await db.whatsAppMessageStatusEvent.create({
      data: {
        pendingMessageId: input.pendingMessageId,
        status: input.status,
        occurredAt: input.occurredAt,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        rawPayload: input.rawPayload === undefined ? Prisma.DbNull : (input.rawPayload as Prisma.InputJsonValue),
      },
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      return null;
    }
    throw error;
  }
}

export interface ApplyStatusUpdateInput {
  externalId: string;
  status: WhatsAppMessageStatus;
  occurredAt: Date;
  errorCode?: string;
  errorMessage?: string;
  rawPayload?: unknown;
}

/**
 * Applies one inbound status webhook: finds the message it's about (safely
 * exits if we have no record of that externalId — e.g. a message sent
 * outside this system), records the chronological status event, and — only
 * for FAILED — also updates the message's own workflow status, since a
 * permanently-failed send is meaningfully different from a successfully
 * sent one. DELIVERED/READ never change PendingWhatsAppMessage.status; that
 * granularity lives entirely in the status-event history.
 */
export async function applyStatusUpdate(input: ApplyStatusUpdateInput, db: PrismaClientOrTransaction = prisma) {
  const pendingMessage = await db.pendingWhatsAppMessage.findUnique({ where: { externalId: input.externalId } });
  if (!pendingMessage) {
    return null;
  }

  const event = await recordStatusEvent(
    {
      pendingMessageId: pendingMessage.id,
      status: input.status,
      occurredAt: input.occurredAt,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      rawPayload: input.rawPayload,
    },
    db,
  );

  if (input.status === "FAILED" && pendingMessage.status !== "FAILED") {
    await db.pendingWhatsAppMessage.update({
      where: { id: pendingMessage.id },
      data: { status: "FAILED", failureReason: input.errorMessage ?? input.errorCode ?? "Delivery failed." },
    });
  }

  return event;
}
