import "server-only";

import { prisma } from "@/server/db/client";
import type { ApprovalRequirement } from "@/server/intelligence/decision/types";
import { PrismaDecisionRepository } from "@/server/persistence/prisma/prisma-decision-repository";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";
import type { SavedDecisionRecord } from "@/server/persistence/types";
import type { AuthenticatedUser } from "./auth";
import { ForbiddenError, NotFoundError } from "./errors";

/**
 * Resolves a DecisionRecord by id and verifies it belongs to the caller's
 * business — never trusts a decisionRecordId just because the client sent
 * one. Returns NOT_FOUND rather than FORBIDDEN for a cross-tenant id, so a
 * caller can't distinguish "doesn't exist" from "exists but isn't yours."
 * Defaults to the app's shared Prisma singleton, same as every
 * Prisma*Repository — accepting one explicitly is what lets the gated DB
 * test suite exercise this real function against sales_os_test only,
 * never whatever DATABASE_URL happens to be set.
 */
export async function loadAuthorizedDecisionRecord(
  user: AuthenticatedUser,
  decisionRecordId: string,
  db: PrismaClientOrTransaction = prisma,
): Promise<SavedDecisionRecord> {
  const decisionRepository = new PrismaDecisionRepository(db);
  const decision = await decisionRepository.findById(decisionRecordId);
  if (!decision || decision.businessId !== user.businessId) {
    throw new NotFoundError("la decisión");
  }
  return decision;
}

export interface AuthorizedConversation {
  id: string;
  businessId: string;
  channel: "WHATSAPP" | "CALL" | "IN_PERSON" | "OTHER";
  entries: { direction: "INBOUND" | "OUTBOUND"; content: string; occurredAt: Date }[];
}

/**
 * Resolves a Conversation by id and verifies it belongs to the caller's
 * business, with entries loaded (order not guaranteed here — see
 * server/application/analyze-conversation-input.ts, which re-sorts
 * defensively). Same NOT_FOUND-not-FORBIDDEN and injectable-db reasoning as above.
 */
export async function loadAuthorizedConversation(
  user: AuthenticatedUser,
  conversationId: string,
  db: PrismaClientOrTransaction = prisma,
): Promise<AuthorizedConversation> {
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, businessId: user.businessId },
    include: { entries: { orderBy: { occurredAt: "asc" } } },
  });

  if (!conversation) {
    throw new NotFoundError("la conversación");
  }

  return conversation;
}

export interface AuthorizedConversationForReply {
  id: string;
  businessId: string;
  leadPhone: string;
  whatsappPhoneNumberId: string | null;
}

/**
 * Resolves what server/application/whatsapp-actions.ts' "queue reply"
 * handler needs — the recipient phone number and which of the business's
 * WhatsApp numbers to send from — tenant-scoped the same way as
 * loadAuthorizedConversation. A conversation with no whatsappPhoneNumberId
 * (not a WhatsApp thread, or predates this phase) can't queue a reply.
 */
export async function loadAuthorizedConversationForReply(
  user: AuthenticatedUser,
  conversationId: string,
  db: PrismaClientOrTransaction = prisma,
): Promise<AuthorizedConversationForReply> {
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, businessId: user.businessId },
    include: { lead: { select: { phone: true } } },
  });

  if (!conversation) {
    throw new NotFoundError("la conversación");
  }

  return {
    id: conversation.id,
    businessId: conversation.businessId,
    leadPhone: conversation.lead.phone,
    whatsappPhoneNumberId: conversation.whatsappPhoneNumberId,
  };
}

export interface AuthorizedPendingWhatsAppMessage {
  id: string;
  businessId: string;
  status: "READY" | "WAITING_APPROVAL" | "SENT" | "FAILED" | "CANCELLED";
}

/** Same NOT_FOUND-not-FORBIDDEN and injectable-db reasoning as loadAuthorizedDecisionRecord. */
export async function loadAuthorizedPendingMessage(
  user: AuthenticatedUser,
  pendingMessageId: string,
  db: PrismaClientOrTransaction = prisma,
): Promise<AuthorizedPendingWhatsAppMessage> {
  const message = await db.pendingWhatsAppMessage.findFirst({
    where: { id: pendingMessageId, businessId: user.businessId },
    select: { id: true, businessId: true, status: true },
  });

  if (!message) {
    throw new NotFoundError("el mensaje");
  }

  return message;
}

export interface AuthorizedConversationForObserverConsole {
  id: string;
  businessId: string;
  leadName: string;
  leadPhone: string;
  channel: string;
  status: string;
}

/**
 * Tenant-scoping only — same NOT_FOUND-not-FORBIDDEN reasoning as
 * loadAuthorizedConversation. Role gating (Observer Console is OWNER-only)
 * is a separate, cheaper check — see assertObserverConsoleAccess below,
 * called first by every handler so a non-OWNER request never pays for this
 * lookup at all.
 */
export async function loadAuthorizedConversationForObserverConsole(
  user: AuthenticatedUser,
  conversationId: string,
  db: PrismaClientOrTransaction = prisma,
): Promise<AuthorizedConversationForObserverConsole> {
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, businessId: user.businessId },
    include: { lead: { select: { name: true, phone: true } } },
  });

  if (!conversation) {
    throw new NotFoundError("la conversación");
  }

  return {
    id: conversation.id,
    businessId: conversation.businessId,
    leadName: conversation.lead.name,
    leadPhone: conversation.lead.phone,
    channel: conversation.channel,
    status: conversation.status,
  };
}

/**
 * Observer Console v1 is OWNER-only (Kori's "admin" role, §14) — an
 * internal/operator tool a SALESPERSON has no business reaching at all.
 * Checked first in every observer-console-actions.ts handler, before any
 * DB lookup or dependency construction — no reason to pay for a
 * conversation or business-wide query a non-OWNER was never going to see
 * the result of.
 */
export function assertObserverConsoleAccess(user: AuthenticatedUser): void {
  if (user.role !== "OWNER") {
    throw new ForbiddenError("La Consola de observación solo está disponible para el propietario del negocio.");
  }
}

/**
 * Only the APPROVE workflow is gated by the decision's own approvalRequirement
 * — "advisor approval" (ADVISOR_APPROVAL_REQUIRED) means any business member
 * may approve; "admin approval" (ADMIN_APPROVAL_REQUIRED) means only an
 * OWNER may. Reject/execute/override/outcome-recording only require
 * business membership (already enforced by loadAuthorizedDecisionRecord) —
 * see the Kori Application Integration v1 report for the reasoning.
 */
export function assertCanApprove(user: AuthenticatedUser, approvalRequirement: ApprovalRequirement): void {
  if (approvalRequirement === "ADMIN_APPROVAL_REQUIRED" && user.role !== "OWNER") {
    throw new ForbiddenError("Esta decisión necesita aprobación del administrador.");
  }
}
