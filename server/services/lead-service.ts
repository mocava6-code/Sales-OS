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

/** "Unambiguous phone placeholder" — the exact name findOrCreateLeadByPhone gives a brand-new Lead. Any other value means a human (or a prior contact-name upgrade) already set something real. */
function isPlaceholderName(name: string, phone: string): boolean {
  return name === phone;
}

/**
 * Opportunistically upgrades a Lead's name to its WhatsApp contact profile
 * name (server/whatsapp/message-normalizer.ts's `contactName`, read from
 * the webhook payload's `contacts[].profile.name` — previously extracted
 * and then discarded; this is the one place it's ever applied). Never
 * overwrites a name a human (or a prior upgrade) already set to something
 * real — only fires when the Lead's current name is still the exact phone
 * placeholder. No-op on a blank/whitespace-only contactName, and a no-op
 * (no write) when the name wouldn't actually change. Best-effort by design
 * — server/whatsapp/gateway.ts is what applies its own try/catch around
 * this, same contract as projectCommercialProfile/recordDomainEvent.
 */
export async function applyWhatsAppContactName(
  lead: { id: string; name: string; phone: string },
  contactName: string | undefined,
  db: PrismaClientOrTransaction = prisma,
): Promise<{ updated: boolean; name: string }> {
  const trimmed = contactName?.trim();
  if (!trimmed) return { updated: false, name: lead.name };
  if (!isPlaceholderName(lead.name, lead.phone)) return { updated: false, name: lead.name };
  if (trimmed === lead.name) return { updated: false, name: lead.name };

  await db.lead.update({ where: { id: lead.id }, data: { name: trimmed } });
  return { updated: true, name: trimmed };
}
