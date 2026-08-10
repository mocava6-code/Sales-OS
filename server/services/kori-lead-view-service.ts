import { prisma } from "@/server/db/client";
import type {
  ConversationStatus,
  CustomerTypeProfile,
  FollowUpStatus,
  LeadNextAction,
  LeadPriority,
  LeadStatus,
  OutcomeAttribution,
  OutcomeType,
} from "@/server/db/generated/client";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";

// Read-only, service-level view of everything Kori Natural Language
// Analytics needs about a Lead — identity, conversation activity,
// follow-up, outcomes, and the canonical commercial profile
// (LeadCommercialProfile, never the raw ConversationSnapshot/DecisionRecord
// Json blobs those columns were projected from). No Groq, no NL querying,
// no schema changes — this is the read model a future query layer queries
// against.

export interface KoriLeadView {
  leadId: string;
  businessId: string;
  name: string;
  phone: string;
  status: LeadStatus;
  priority: LeadPriority;
  assignedToUserId: string | null;
  createdAt: string;

  activeConversationId: string | null;
  conversationState: ConversationStatus | null;
  lastInboundMessage: { content: string; occurredAt: string } | null;
  lastOutboundMessage: { content: string; occurredAt: string } | null;

  nextFollowUpDueAt: string | null;
  nextFollowUpStatus: FollowUpStatus | null;

  lastOutcomeType: OutcomeType | null;
  lastOutcomeAt: string | null;
  lastOutcomeAttribution: OutcomeAttribution | null;

  commercialProfile: {
    vehicleBrand: string | null;
    vehicleModel: string | null;
    vehicleYear: number | null;
    productInterest: string | null;
    customerType: CustomerTypeProfile | null;
    nextAction: LeadNextAction | null;
    nextActionReason: string | null;
    primaryObjection: string | null;
    updatedAt: string | null;
  } | null;
}

const LEAD_VIEW_INCLUDE = {
  commercialProfile: true,
  followUps: { where: { status: { not: "DONE" as const } }, orderBy: { dueAt: "asc" as const }, take: 1 },
  // Bounded to the single most-recently-touched conversation and its last
  // 20 entries — a flagged phase-1 simplification: a lead with an older
  // still-open conversation whose latest message predates a different,
  // more-recently-touched conversation could miss a message here. Acceptable
  // given this view's only consumer today is a future read-only NL layer,
  // not a live inbox.
  conversations: {
    orderBy: { lastEntryAt: "desc" as const },
    take: 1,
    include: { entries: { orderBy: { occurredAt: "desc" as const }, take: 20 } },
  },
};

function toView(
  lead: {
    id: string;
    businessId: string;
    name: string;
    phone: string;
    status: LeadStatus;
    priority: LeadPriority;
    assignedToUserId: string | null;
    createdAt: Date;
    commercialProfile: {
      vehicleBrand: string | null;
      vehicleModel: string | null;
      vehicleYear: number | null;
      productInterest: string | null;
      customerType: CustomerTypeProfile | null;
      nextAction: LeadNextAction | null;
      nextActionReason: string | null;
      primaryObjection: string | null;
      updatedAt: Date;
    } | null;
    followUps: { dueAt: Date; status: FollowUpStatus }[];
    conversations: {
      id: string;
      status: ConversationStatus;
      entries: { direction: "INBOUND" | "OUTBOUND"; content: string; occurredAt: Date }[];
    }[];
  },
  lastOutcome: { outcomeType: OutcomeType; occurredAt: Date; attribution: OutcomeAttribution | null } | null,
): KoriLeadView {
  const activeConversation = lead.conversations[0] ?? null;
  const lastInboundEntry = activeConversation?.entries.find((e) => e.direction === "INBOUND") ?? null;
  const lastOutboundEntry = activeConversation?.entries.find((e) => e.direction === "OUTBOUND") ?? null;
  const nextFollowUp = lead.followUps[0] ?? null;

  return {
    leadId: lead.id,
    businessId: lead.businessId,
    name: lead.name,
    phone: lead.phone,
    status: lead.status,
    priority: lead.priority,
    assignedToUserId: lead.assignedToUserId,
    createdAt: lead.createdAt.toISOString(),

    activeConversationId: activeConversation?.id ?? null,
    conversationState: activeConversation?.status ?? null,
    lastInboundMessage: lastInboundEntry ? { content: lastInboundEntry.content, occurredAt: lastInboundEntry.occurredAt.toISOString() } : null,
    lastOutboundMessage: lastOutboundEntry ? { content: lastOutboundEntry.content, occurredAt: lastOutboundEntry.occurredAt.toISOString() } : null,

    nextFollowUpDueAt: nextFollowUp ? nextFollowUp.dueAt.toISOString() : null,
    nextFollowUpStatus: nextFollowUp?.status ?? null,

    lastOutcomeType: lastOutcome?.outcomeType ?? null,
    lastOutcomeAt: lastOutcome ? lastOutcome.occurredAt.toISOString() : null,
    lastOutcomeAttribution: lastOutcome?.attribution ?? null,

    commercialProfile: lead.commercialProfile
      ? {
          vehicleBrand: lead.commercialProfile.vehicleBrand,
          vehicleModel: lead.commercialProfile.vehicleModel,
          vehicleYear: lead.commercialProfile.vehicleYear,
          productInterest: lead.commercialProfile.productInterest,
          customerType: lead.commercialProfile.customerType,
          nextAction: lead.commercialProfile.nextAction,
          nextActionReason: lead.commercialProfile.nextActionReason,
          primaryObjection: lead.commercialProfile.primaryObjection,
          updatedAt: lead.commercialProfile.updatedAt.toISOString(),
        }
      : null,
  };
}

/**
 * Outcome has no direct leadId — only decisionRecordId -> DecisionRecord.conversationId
 * -> Conversation.leadId, so this join is unavoidable. No Json field from
 * ConversationSnapshot/DecisionRecord is ever read here — only Outcome's
 * own scalar columns (it has none of its own Json columns).
 */
async function findLastOutcome(leadId: string, db: PrismaClientOrTransaction) {
  return db.outcome.findFirst({
    where: { decisionRecord: { conversation: { leadId } } },
    orderBy: { occurredAt: "desc" },
    select: { outcomeType: true, occurredAt: true, attribution: true },
  });
}

export async function getKoriLeadView(businessId: string, leadId: string, db: PrismaClientOrTransaction = prisma): Promise<KoriLeadView | null> {
  const lead = await db.lead.findFirst({ where: { id: leadId, businessId }, include: LEAD_VIEW_INCLUDE });
  if (!lead) return null;

  const lastOutcome = await findLastOutcome(leadId, db);
  return toView(lead, lastOutcome);
}

export async function listKoriLeadViews(businessId: string, db: PrismaClientOrTransaction = prisma): Promise<KoriLeadView[]> {
  const leads = await db.lead.findMany({ where: { businessId }, include: LEAD_VIEW_INCLUDE });
  return Promise.all(leads.map(async (lead) => toView(lead, await findLastOutcome(lead.id, db))));
}
