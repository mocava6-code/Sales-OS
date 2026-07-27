// OWNER review/promotion — the ONLY place a KnowledgeCandidate becomes
// organizational truth (Sprint 8 review, item 3: no auto-promotion exists
// anywhere in this codebase; APPROVED is reached exclusively through an
// explicit call to promoteCandidate below). Also the only place a
// KnowledgeItem/OperationalInsight is ever created — there is still no
// manual "Teach Sales OS" form.

import "server-only";

import { prisma } from "@/server/db/client";
import type { KnowledgeCandidate, KnowledgeCategory, PrismaClient } from "@/server/db/generated/client";
import { InvalidCandidateStatusTransitionError, KnowledgeCandidateNotFoundError } from "./errors";

const PRICING_FRESHNESS_DAYS = 30;
const CATEGORIES_REQUIRING_FRESHNESS: readonly string[] = ["PRICING", "COMMERCIAL_POLICY", "PROMOTION"];

function computeExpiresAt(category: string): Date | null {
  if (!CATEGORIES_REQUIRING_FRESHNESS.includes(category)) return null;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + PRICING_FRESHNESS_DAYS);
  return expiresAt;
}

function assertPromotable(candidate: Pick<KnowledgeCandidate, "status">): void {
  if (candidate.status === "APPROVED" || candidate.status === "REJECTED") {
    throw new InvalidCandidateStatusTransitionError(candidate.status, "APPROVED");
  }
}

export interface PromoteCandidateResult {
  candidateId: string;
  knowledgeItemId?: string;
  operationalInsightId?: string;
}

/**
 * Promotes one candidate. Side effects, all in one transaction:
 * - creates the KnowledgeItem or OperationalInsight (never both).
 * - any OTHER pending candidate this one is CONTRADICTORY toward (via
 *   KnowledgeCandidateRelationship) is deterministically REJECTED — an
 *   explicit consequence of the OWNER's decision, never autonomous.
 * - any ACTIVE KnowledgeItem/OperationalInsight this one is CONTRADICTORY
 *   toward is flipped to SUPERSEDED, linked via supersededByItemId.
 */
export async function promoteCandidate(
  candidateId: string,
  businessId: string,
  approvedByUserId: string,
  db: PrismaClient = prisma,
): Promise<PromoteCandidateResult> {
  const candidate = await db.knowledgeCandidate.findFirst({ where: { id: candidateId, businessId } });
  if (!candidate) throw new KnowledgeCandidateNotFoundError(candidateId);
  assertPromotable(candidate);

  const relationships = await db.knowledgeCandidateRelationship.findMany({ where: { candidateId } });
  const contradictoryCandidateIds = relationships.filter((r) => r.classification === "CONTRADICTORY" && r.targetCandidateId).map((r) => r.targetCandidateId!);
  const contradictoryKnowledgeItemIds = relationships.filter((r) => r.classification === "CONTRADICTORY" && r.targetKnowledgeItemId).map((r) => r.targetKnowledgeItemId!);
  const contradictoryInsightIds = relationships.filter((r) => r.classification === "CONTRADICTORY" && r.targetOperationalInsightId).map((r) => r.targetOperationalInsightId!);

  const now = new Date();

  if (candidate.class === "FACTUAL") {
    const item = await db.knowledgeItem.create({
      data: {
        businessId,
        title: candidate.subject,
        content: candidate.statement,
        category: candidate.proposedFactualCategory as KnowledgeCategory,
        createdByUserId: approvedByUserId,
        approvedByUserId,
        approvedAt: now,
        confidence: candidate.confidence,
        originCandidateId: candidate.id,
        expiresAt: computeExpiresAt(candidate.proposedFactualCategory as string),
      },
    });

    await db.$transaction([
      db.knowledgeCandidate.update({
        where: { id: candidateId },
        data: { status: "APPROVED", reviewedByUserId: approvedByUserId, reviewedAt: now, promotedKnowledgeItemId: item.id },
      }),
      ...(contradictoryCandidateIds.length > 0
        ? [
            db.knowledgeCandidate.updateMany({
              where: { id: { in: contradictoryCandidateIds }, status: { notIn: ["APPROVED", "REJECTED"] } },
              data: { status: "REJECTED", reviewedByUserId: approvedByUserId, reviewedAt: now, rejectionReason: `Superseded by approved candidate ${candidateId}.` },
            }),
          ]
        : []),
      ...(contradictoryKnowledgeItemIds.length > 0
        ? [
            db.knowledgeItem.updateMany({
              where: { id: { in: contradictoryKnowledgeItemIds } },
              data: { status: "SUPERSEDED", supersededByItemId: item.id },
            }),
          ]
        : []),
    ]);

    return { candidateId, knowledgeItemId: item.id };
  }

  const insight = await db.operationalInsight.create({
    data: {
      businessId,
      category: candidate.proposedBehaviorCategory!,
      statement: candidate.statement,
      confidence: candidate.confidence,
      originCandidateId: candidate.id,
      occurrenceCount: candidate.occurrenceCount,
      firstObservedAt: candidate.firstSeenAt,
      lastObservedAt: candidate.lastSeenAt,
      approvedByUserId,
      approvedAt: now,
    },
  });

  await db.$transaction([
    db.knowledgeCandidate.update({
      where: { id: candidateId },
      data: { status: "APPROVED", reviewedByUserId: approvedByUserId, reviewedAt: now, promotedOperationalInsightId: insight.id },
    }),
    ...(contradictoryCandidateIds.length > 0
      ? [
          db.knowledgeCandidate.updateMany({
            where: { id: { in: contradictoryCandidateIds }, status: { notIn: ["APPROVED", "REJECTED"] } },
            data: { status: "REJECTED", reviewedByUserId: approvedByUserId, reviewedAt: now, rejectionReason: `Superseded by approved candidate ${candidateId}.` },
          }),
        ]
      : []),
    ...(contradictoryInsightIds.length > 0
      ? [
          db.operationalInsight.updateMany({
            where: { id: { in: contradictoryInsightIds } },
            data: { status: "SUPERSEDED" },
          }),
        ]
      : []),
  ]);

  return { candidateId, operationalInsightId: insight.id };
}

export async function rejectCandidate(
  candidateId: string,
  businessId: string,
  rejectedByUserId: string,
  rejectionReason: string | undefined,
  db: PrismaClient = prisma,
): Promise<{ candidateId: string }> {
  const candidate = await db.knowledgeCandidate.findFirst({ where: { id: candidateId, businessId } });
  if (!candidate) throw new KnowledgeCandidateNotFoundError(candidateId);
  if (candidate.status === "APPROVED" || candidate.status === "REJECTED") {
    throw new InvalidCandidateStatusTransitionError(candidate.status, "REJECTED");
  }

  await db.knowledgeCandidate.update({
    where: { id: candidateId },
    data: { status: "REJECTED", reviewedByUserId: rejectedByUserId, reviewedAt: new Date(), rejectionReason },
  });

  return { candidateId };
}
