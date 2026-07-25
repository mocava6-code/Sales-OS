import { prisma } from "@/server/db/client";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";
import type { LeadInput } from "@/lib/validations/lead";

export async function listLeads(businessId: string) {
  return prisma.lead.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getLead(businessId: string, leadId: string, db: PrismaClientOrTransaction = prisma) {
  return db.lead.findFirst({
    where: { id: leadId, businessId },
    include: {
      conversations: {
        orderBy: { lastEntryAt: "desc" },
        include: { entries: { orderBy: { occurredAt: "asc" } } },
      },
      followUps: { orderBy: { dueAt: "asc" } },
      // Sprint 7 — Lead Commercial State's relative-date extractor needs the
      // business's timezone; selecting it here avoids a second query on the
      // Lead page (server/lead-commercial-state/build-lead-commercial-state.ts).
      business: { select: { timezone: true } },
    },
  });
}

export async function createLead(businessId: string, data: LeadInput) {
  return prisma.lead.create({
    data: {
      businessId,
      name: data.name,
      phone: data.phone,
      priority: data.priority,
    },
  });
}

export async function listHighPriorityLeads(businessId: string) {
  return prisma.lead.findMany({
    where: {
      businessId,
      priority: "HIGH",
      status: { notIn: ["WON", "LOST"] },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * The tenant-ownership check every other service must run before writing a
 * child record (Conversation, FollowUp) off a leadId supplied by a form.
 * A leadId is never trusted just because it was present in a request.
 */
export async function assertLeadBelongsToBusiness(businessId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, businessId },
    select: { id: true },
  });

  if (!lead) {
    throw new Error("Lead not found.");
  }

  return lead;
}

/**
 * "Identify customer" for an inbound WhatsApp message (server/whatsapp/gateway.ts)
 * — matches by exact phone string within the tenant, creating a bare-minimum
 * Lead if this number has never messaged before. `phone` must already be
 * normalized (see server/whatsapp/message-normalizer.ts) — this function
 * does no format coercion of its own, so the same number always matches the
 * same Lead regardless of caller.
 */
export async function findOrCreateLeadByPhone(businessId: string, phone: string, db: PrismaClientOrTransaction = prisma) {
  const existing = await db.lead.findFirst({ where: { businessId, phone } });
  if (existing) return existing;

  return db.lead.create({
    data: { businessId, phone, name: phone, priority: "NORMAL" },
  });
}
