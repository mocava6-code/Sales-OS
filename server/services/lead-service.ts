import { prisma } from "@/server/db/client";
import type { LeadInput } from "@/lib/validations/lead";

export async function listLeads(businessId: string) {
  return prisma.lead.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getLead(businessId: string, leadId: string) {
  return prisma.lead.findFirst({
    where: { id: leadId, businessId },
    include: {
      conversations: {
        orderBy: { lastEntryAt: "desc" },
        include: { entries: { orderBy: { occurredAt: "asc" } } },
      },
      followUps: { orderBy: { dueAt: "asc" } },
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
