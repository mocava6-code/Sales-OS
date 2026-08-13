// Kori Sales Memory v1 — the first conversion intelligence, built entirely
// on top of the Outcome rows the "Marcar resultado" button now produces.
// Every number here is a straightforward aggregation, never a second AI
// call — the insight sentence at the end is a template filled with real
// computed numbers, same philosophy as buildPulseSummary in
// kori-briefing-service.ts.

import { prisma } from "@/server/db/client";
import { LOST_REASON_LABELS, type LostReason } from "@/lib/validations/outcome";

const MIN_DECIDED_FOR_PRODUCT_INSIGHT = 2;

export interface LostReasonBreakdown {
  reason: LostReason;
  label: string;
  count: number;
}

export interface ProductConversion {
  product: string;
  closed: number;
  lost: number;
  decided: number;
  conversionRate: number;
}

export interface KoriConversionSummary {
  commercialConversations: number;
  closed: number;
  lost: number;
  pending: number;
  conversionRate: number | null;
  topLostReasons: LostReasonBreakdown[];
  productConversion: ProductConversion[];
  avgSalesCycleDays: number | null;
  insight: string | null;
}

interface DecidedOutcomeRow {
  outcomeType: "SALE_CLOSED" | "SALE_LOST";
  productSold: string | null;
  occurredAt: Date;
  conversationCreatedAt: Date;
  productInterest: string | null;
}

/** Groups closed/lost outcomes by product (what was sold, falling back to what the lead was originally asking about) and computes each group's conversion rate. */
export function deriveProductConversion(rows: DecidedOutcomeRow[]): ProductConversion[] {
  const byProduct = new Map<string, { closed: number; lost: number }>();

  for (const row of rows) {
    const product = row.productSold ?? row.productInterest;
    if (!product) continue;
    const entry = byProduct.get(product) ?? { closed: 0, lost: 0 };
    if (row.outcomeType === "SALE_CLOSED") entry.closed += 1;
    else entry.lost += 1;
    byProduct.set(product, entry);
  }

  return [...byProduct.entries()]
    .map(([product, { closed, lost }]) => ({
      product,
      closed,
      lost,
      decided: closed + lost,
      conversionRate: closed + lost > 0 ? closed / (closed + lost) : 0,
    }))
    .sort((a, b) => b.decided - a.decided);
}

/**
 * "Kori detecta que X tiene más intención pero menor conversión que Y" — a
 * template, not free text: only fires when the highest-demand product with
 * enough decided outcomes to say anything (>= MIN_DECIDED_FOR_PRODUCT_INSIGHT)
 * converts below the average of the others. Silent (null) otherwise —
 * never forces a comparison that isn't really there.
 */
export function buildConversionInsight(
  demandSignals: { label: string; count: number }[],
  productConversion: ProductConversion[],
): string | null {
  const eligible = productConversion.filter((p) => p.decided >= MIN_DECIDED_FOR_PRODUCT_INSIGHT);
  if (eligible.length < 2) return null;

  const byDemandRank = demandSignals
    .map((signal) => eligible.find((p) => p.product === signal.label))
    .filter((p): p is ProductConversion => p !== undefined);
  if (byDemandRank.length < 2) return null;

  const topDemand = byDemandRank[0];
  const others = eligible.filter((p) => p.product !== topDemand.product);
  const othersAvgRate = others.reduce((sum, p) => sum + p.conversionRate, 0) / others.length;

  if (topDemand.conversionRate >= othersAvgRate) return null;

  const bestOther = [...others].sort((a, b) => b.conversionRate - a.conversionRate)[0];
  return `Kori detecta que ${topDemand.product} tiene más intención pero menor conversión que ${bestOther.product}.`;
}

export async function getKoriConversionIntelligence(
  businessId: string,
  periodStart: Date,
  now: Date = new Date(),
  demandSignals: { label: string; count: number }[] = [],
): Promise<KoriConversionSummary> {
  const [activeConversationCount, notAnOpportunityConversationIds, decidedOutcomes, lostOutcomes] = await Promise.all([
    prisma.conversation.count({ where: { businessId, lastEntryAt: { gte: periodStart, lte: now } } }),
    prisma.outcome
      .findMany({ where: { businessId, outcomeType: "NOT_AN_OPPORTUNITY" }, select: { conversationId: true } })
      .then((rows) => new Set(rows.map((r) => r.conversationId))),
    prisma.outcome.findMany({
      where: { businessId, outcomeType: { in: ["SALE_CLOSED", "SALE_LOST"] }, occurredAt: { gte: periodStart, lte: now } },
      select: {
        outcomeType: true,
        productSold: true,
        occurredAt: true,
        conversation: { select: { createdAt: true, lead: { select: { commercialProfile: { select: { productInterest: true } } } } } },
      },
    }),
    prisma.outcome.findMany({
      where: { businessId, outcomeType: "SALE_LOST", occurredAt: { gte: periodStart, lte: now } },
      select: { lostReason: true },
    }),
  ]);

  // Excludes conversations ever marked NOT_AN_OPPORTUNITY from the
  // "commercial conversations" count regardless of when that marking
  // happened — a conversation confirmed as spam/test doesn't become real
  // again just because this period's active-conversation query touches it.
  const commercialConversations = Math.max(0, activeConversationCount - notAnOpportunityConversationIds.size);

  const closed = decidedOutcomes.filter((o) => o.outcomeType === "SALE_CLOSED").length;
  const lost = decidedOutcomes.filter((o) => o.outcomeType === "SALE_LOST").length;
  // A closed/lost outcome can come from a conversation whose lastEntryAt
  // isn't in this window (decided today, last message was weeks ago) — the
  // pending count is a useful approximation at pilot scale, not an exact
  // reconciliation, same spirit as this codebase's other "good enough for
  // a handful of businesses" simplifications (see kori-briefing-service.ts).
  const pending = Math.max(0, commercialConversations - closed - lost);

  const conversionRate = closed + lost > 0 ? closed / (closed + lost) : null;

  const lostReasonCounts = new Map<LostReason, number>();
  for (const row of lostOutcomes) {
    if (!row.lostReason) continue;
    const reason = row.lostReason as LostReason;
    lostReasonCounts.set(reason, (lostReasonCounts.get(reason) ?? 0) + 1);
  }
  const topLostReasons: LostReasonBreakdown[] = [...lostReasonCounts.entries()]
    .map(([reason, count]) => ({ reason, label: LOST_REASON_LABELS[reason], count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  const productConversion = deriveProductConversion(
    decidedOutcomes.map((o) => ({
      outcomeType: o.outcomeType as "SALE_CLOSED" | "SALE_LOST",
      productSold: o.productSold,
      occurredAt: o.occurredAt,
      conversationCreatedAt: o.conversation.createdAt,
      productInterest: o.conversation.lead.commercialProfile?.productInterest ?? null,
    })),
  );

  const closedOutcomes = decidedOutcomes.filter((o) => o.outcomeType === "SALE_CLOSED");
  const avgSalesCycleDays =
    closedOutcomes.length > 0
      ? closedOutcomes.reduce((sum, o) => sum + (o.occurredAt.getTime() - o.conversation.createdAt.getTime()), 0) /
        closedOutcomes.length /
        (24 * 60 * 60 * 1000)
      : null;

  return {
    commercialConversations,
    closed,
    lost,
    pending,
    conversionRate,
    topLostReasons,
    productConversion,
    avgSalesCycleDays,
    insight: buildConversionInsight(demandSignals, productConversion),
  };
}
