import { prisma } from "@/server/db/client";

export interface PendingDecisionPreview {
  id: string;
  title: string;
  type: string;
  leadId: string;
  leadName: string;
  createdAt: Date;
}

/**
 * Lightweight read for surfaces that only need "is there anything to
 * review" (the Kori briefing's decisions card) — not the full
 * DecisionSummaryDTO the review page needs. Oldest first: a decision the
 * engine proposed and nobody looked at yet should surface before one from
 * five minutes ago.
 */
export async function listPendingDecisionsPreview(businessId: string, limit = 5): Promise<PendingDecisionPreview[]> {
  const decisions = await prisma.decisionRecord.findMany({
    where: { businessId, status: "PROPOSED" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      title: true,
      type: true,
      createdAt: true,
      conversation: { select: { lead: { select: { id: true, name: true } } } },
    },
  });

  return decisions.map((decision) => ({
    id: decision.id,
    title: decision.title,
    type: decision.type,
    leadId: decision.conversation.lead.id,
    leadName: decision.conversation.lead.name,
    createdAt: decision.createdAt,
  }));
}

export async function countPendingDecisions(businessId: string): Promise<number> {
  return prisma.decisionRecord.count({ where: { businessId, status: "PROPOSED" } });
}
