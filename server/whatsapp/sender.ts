import "server-only";

import { prisma } from "@/server/db/client";
import type { PrismaClient } from "@/server/db/generated/client";
import {
  recordDomainEvent as recordDomainEventDefault,
  type RecordDomainEventInput,
  type RecordDomainEventResult,
} from "@/server/orchestration/record-domain-event";
import { PrismaTransactionRunner } from "@/server/persistence/prisma/prisma-transaction-runner";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";
import { InvalidPendingMessageStatusTransitionError, PendingMessageNotFoundError, WhatsAppSendFailedError } from "./errors";
import { findPendingMessageById, markMessageFailed, markMessageSent } from "./queue";

/**
 * Bound to the same `db` sendReadyMessage was given — never a
 * composition-root singleton — so a test-injected db (see sender.db.test.ts)
 * is what Observer Mode's write targets too, not the app's real DATABASE_URL.
 * The cast is safe: sendReadyMessage is never called with an existing
 * Prisma.TransactionClient (there'd be nothing to nest a fresh
 * event-recording transaction inside) — only the app's shared PrismaClient
 * singleton or a test PrismaClient, both real PrismaTransactionRunner targets.
 */
function defaultRecordDomainEvent(input: RecordDomainEventInput, db: PrismaClientOrTransaction): Promise<RecordDomainEventResult> {
  return recordDomainEventDefault(input, { transactionRunner: new PrismaTransactionRunner(db as PrismaClient) });
}

const DEFAULT_API_VERSION = "v21.0";
const DEFAULT_BASE_URL = "https://graph.facebook.com";

export interface SendTextMessageInput {
  phoneNumberId: string;
  to: string;
  body: string;
}

export interface SendTextMessageResult {
  externalId: string;
}

/**
 * The only interface anything outside this file depends on — a real
 * Meta-backed implementation and a test double both satisfy it identically.
 * No Meta SDK, no fetch call, ever crosses this boundary into the client.
 */
export interface WhatsAppSenderClient {
  sendTextMessage(input: SendTextMessageInput): Promise<SendTextMessageResult>;
}

export interface MetaWhatsAppSenderConfig {
  accessToken: string;
  apiVersion?: string;
  baseUrl?: string;
}

export function createMetaWhatsAppSenderClient(config: MetaWhatsAppSenderConfig): WhatsAppSenderClient {
  const apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

  return {
    async sendTextMessage(input: SendTextMessageInput): Promise<SendTextMessageResult> {
      const url = `${baseUrl}/${apiVersion}/${input.phoneNumberId}/messages`;

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: input.to,
            type: "text",
            text: { body: input.body },
          }),
        });
      } catch (cause) {
        throw new WhatsAppSendFailedError("Network error calling the WhatsApp Graph API.", cause);
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new WhatsAppSendFailedError(`WhatsApp Graph API returned ${response.status}: ${errorBody}`);
      }

      const json = (await response.json()) as { messages?: Array<{ id?: string }> };
      const externalId = json.messages?.[0]?.id;
      if (!externalId) {
        throw new WhatsAppSendFailedError("WhatsApp Graph API response did not include a message id.");
      }

      return { externalId };
    },
  };
}

/** The only place process.env is read for the WhatsApp sender. */
export function createWhatsAppSenderClientFromEnv(): WhatsAppSenderClient {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("WHATSAPP_ACCESS_TOKEN is not configured. Set it in your environment (see .env.example).");
  }
  return createMetaWhatsAppSenderClient({
    accessToken,
    apiVersion: process.env.WHATSAPP_API_VERSION,
    baseUrl: process.env.WHATSAPP_GRAPH_API_BASE_URL,
  });
}

export interface SendReadyMessageDependencies {
  client: WhatsAppSenderClient;
  db?: PrismaClientOrTransaction;
  /** Observer Mode v1 — best-effort, never allowed to fail the send it's describing. */
  recordDomainEvent?: (input: RecordDomainEventInput) => Promise<RecordDomainEventResult>;
}

/**
 * The only function that moves a PendingWhatsAppMessage from READY to SENT
 * — called explicitly (a server action), never from a background worker or
 * poller. Single attempt, no retries (deliberately out of scope for v1): a
 * failed Graph API call marks the message FAILED and re-throws.
 */
export async function sendReadyMessage(
  pendingMessageId: string,
  dependencies: SendReadyMessageDependencies,
): Promise<Awaited<ReturnType<typeof markMessageSent>>> {
  const db = dependencies.db ?? prisma;
  const recordDomainEvent = dependencies.recordDomainEvent ?? ((input: RecordDomainEventInput) => defaultRecordDomainEvent(input, db));

  const message = await findPendingMessageById(pendingMessageId, db);
  if (!message) {
    throw new PendingMessageNotFoundError(pendingMessageId);
  }
  if (message.status !== "READY") {
    throw new InvalidPendingMessageStatusTransitionError(message.status, "SENT");
  }

  const phoneNumber = await db.whatsAppPhoneNumber.findUnique({ where: { id: message.whatsappPhoneNumberId } });
  if (!phoneNumber) {
    throw new WhatsAppSendFailedError(`PendingWhatsAppMessage "${pendingMessageId}" has no registered phone number.`);
  }

  try {
    const { externalId } = await dependencies.client.sendTextMessage({
      phoneNumberId: phoneNumber.phoneNumberId,
      to: message.toPhoneNumber,
      body: message.body,
    });
    const sent = await markMessageSent(pendingMessageId, externalId, db);

    // Observer Mode v1 — record MESSAGE_SENT. Best-effort: a failure here
    // must never surface as a send failure, since the WhatsApp message and
    // its ConversationEntry are already durably persisted at this point.
    try {
      await recordDomainEvent({
        event: {
          type: "MESSAGE_SENT",
          businessId: message.businessId,
          conversationId: message.conversationId,
          conversationEntryId: sent.conversationEntryId,
          content: message.body,
          externalId,
          occurredAt: sent.sentAt ?? new Date(),
        },
        conversationEntryId: sent.conversationEntryId,
      });
    } catch {
      // Swallowed deliberately — see doc comment above.
    }

    return sent;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error sending the WhatsApp message.";
    await markMessageFailed(pendingMessageId, reason, db);
    throw error;
  }
}
