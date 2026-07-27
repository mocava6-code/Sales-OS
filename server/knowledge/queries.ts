// Read-only Knowledge queries — the data layer behind app/(app)/knowledge/**.
// Browsing is open to every role (Sprint 8 review — only ingestion/review
// mutations are OWNER-gated), so every function here just tenant-scopes by
// businessId, same convention as server/services/lead-service.ts.

import { prisma } from "@/server/db/client";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";

export async function getKnowledgeDashboardCounts(businessId: string, db: PrismaClientOrTransaction = prisma) {
  const [sources, newCandidates, conflictCandidates, knowledgeItems, operationalInsights] = await Promise.all([
    db.knowledgeSource.count({ where: { businessId } }),
    db.knowledgeCandidate.count({ where: { businessId, status: { in: ["NEW", "REINFORCED"] } } }),
    db.knowledgeCandidate.count({ where: { businessId, status: "CONFLICT" } }),
    db.knowledgeItem.count({ where: { businessId, status: "ACTIVE" } }),
    db.operationalInsight.count({ where: { businessId, status: "ACTIVE" } }),
  ]);

  return { sources, newCandidates, conflictCandidates, knowledgeItems, operationalInsights };
}

export async function listKnowledgeSources(businessId: string, db: PrismaClientOrTransaction = prisma) {
  return db.knowledgeSource.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { importedConversations: true, websitePages: true } },
    },
  });
}

export type CandidateFilter = "NEW" | "CONFLICT" | "REPEATED";

/**
 * "Repeated" (Sprint 8 Phase 9's third candidates tab) means REINFORCED —
 * candidates with more than one corroborating occurrence.
 */
export async function listKnowledgeCandidates(businessId: string, filter: CandidateFilter, db: PrismaClientOrTransaction = prisma) {
  const status = filter === "REPEATED" ? "REINFORCED" : filter;
  return db.knowledgeCandidate.findMany({
    where: { businessId, status },
    orderBy: { lastSeenAt: "desc" },
    include: {
      evidence: { orderBy: { createdAt: "desc" }, take: 3 },
      relationships: { include: { targetCandidate: true, targetKnowledgeItem: true, targetOperationalInsight: true } },
    },
  });
}

export async function getKnowledgeCandidateCounts(businessId: string, db: PrismaClientOrTransaction = prisma) {
  const [newCount, conflictCount, repeatedCount] = await Promise.all([
    db.knowledgeCandidate.count({ where: { businessId, status: "NEW" } }),
    db.knowledgeCandidate.count({ where: { businessId, status: "CONFLICT" } }),
    db.knowledgeCandidate.count({ where: { businessId, status: "REINFORCED" } }),
  ]);
  return { newCount, conflictCount, repeatedCount };
}

export async function listActiveKnowledgeItems(businessId: string, db: PrismaClientOrTransaction = prisma) {
  return db.knowledgeItem.findMany({ where: { businessId, status: "ACTIVE" }, orderBy: { category: "asc" } });
}

export async function listActiveOperationalInsights(businessId: string, db: PrismaClientOrTransaction = prisma) {
  return db.operationalInsight.findMany({ where: { businessId, status: "ACTIVE" }, orderBy: { category: "asc" } });
}
