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
  queueWhatsAppReplySchema,
  rejectWhatsAppReplySchema,
  sendQueuedReplySchema,
} from "@/lib/validations/whatsapp";
import type { PendingWhatsAppMessage as PendingWhatsAppMessageRow } from "@/server/db/generated/client";
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
import { type AuthContextResolver, type AuthenticatedUser, defaultAuthContextResolver, requireAuthenticatedUser } from "./auth";
import { toPendingWhatsAppMessageSummaryDTO, type PendingWhatsAppMessageSummaryDTO } from "./dto";
import { type ApplicationResult, InvalidInputError, toApplicationResult } from "./errors";

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
      throw new InvalidInputError({ conversationId: ["This conversation has no WhatsApp number associated with it."] });
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
