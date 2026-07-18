import { prisma } from "@/server/db/client";
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
