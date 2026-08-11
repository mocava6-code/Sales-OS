import { prisma } from "@/server/db/client";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";
import type { LeadInput } from "@/lib/validations/lead";
import { buildLegacyPhoneLookupCandidates } from "@/lib/phone";

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
 * or manual/historical-import lead creation (server/actions/leads.ts,
 * server/application/whatsapp-actions.ts) — creates a bare-minimum Lead if
 * this number has never been seen before. `phone` must already be
 * normalized to canonical E.164 (see lib/phone.ts) — this function does no
 * format coercion of its own.
 *
 * Kori Data Correctness Phase 1D transition measure: the lookup checks
 * `phone` PLUS lib/phone.ts's buildLegacyPhoneLookupCandidates(phone) — a
 * small, fixed, exact-string set (canonical E.164 and the same digits with
 * no leading "+") — so an existing Lead written before normalization
 * existed is still found and reused, never duplicated, purely because of a
 * phone-representation mismatch. Still scoped by businessId; never a
 * fuzzy/suffix match. If more than one Lead already matches (a duplicate
 * pair that predates this fix), the oldest is reused — the other is left
 * exactly as-is, never merged or rewritten; that's the separate,
 * not-yet-decided remediation work. A brand-new Lead is always created
 * with the canonical `phone` value, never a legacy one — canonical
 * storage for new/updated rows stays E.164 with a leading "+".
 */
export async function findOrCreateLeadByPhone(businessId: string, phone: string, db: PrismaClientOrTransaction = prisma) {
  const candidates = buildLegacyPhoneLookupCandidates(phone);
  const existing = await db.lead.findFirst({
    where: { businessId, phone: { in: candidates } },
    orderBy: { createdAt: "asc" },
  });
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
