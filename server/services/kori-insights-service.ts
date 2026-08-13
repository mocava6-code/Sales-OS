// Kori Commercial Intelligence V2 — the page-facing composition layer for
// "Aprendizajes de Kori," built on top of server/insights/** (the pure
// engine) the exact same way kori-briefing-service.ts composes Today's
// data sources. Every sentence here is a deterministic template filled
// with real numbers — never a second AI call, same rule as buildPulseSummary
// and buildConversionInsight before it: a wrong insight is worse than none.
//
// Deliberately does NOT call getTeamPerformance — team performance is
// OWNER-only and never belongs on a passively-visible card any business
// member can see (see server/insights/team-performance.ts's own doc
// comment). It's available for a future OWNER-gated surface, not part of
// this page's default composition.

import { getProductPerformance, type ProductPerformance, type ProductPerformanceSummary } from "@/server/insights/product-performance";
import { getLossAnalysis, type LossAnalysis } from "@/server/insights/loss-analysis";
import type { KoriNeedsOutcomeNudge } from "./kori-briefing-service";

const MIN_INTERESTED_FOR_TREND = 3;
const MIN_TREND_PERCENT_FOR_CARD = 20;
const MIN_CLUSTER_FOR_OPPORTUNITY_CARD = 2;
const MAX_INSIGHT_CARDS = 5;

export type InsightCardType = "OPORTUNIDAD" | "TENDENCIA" | "PROBLEMA";

export interface InsightCard {
  type: InsightCardType;
  text: string;
}

export interface KoriInsightsSummary {
  executiveSummary: string;
  cards: InsightCard[];
  productPerformance: ProductPerformance[];
  periodDays: number;
}

/** Groups leads with no recorded outcome by product and flags the largest cluster — "N clientes preguntaron por X pero no recibieron seguimiento." */
export function deriveOpportunityCard(needsOutcomeNudges: KoriNeedsOutcomeNudge[]): InsightCard | null {
  const byVehicleLine = new Map<string, number>();
  for (const nudge of needsOutcomeNudges) {
    if (!nudge.vehicleLine) continue;
    byVehicleLine.set(nudge.vehicleLine, (byVehicleLine.get(nudge.vehicleLine) ?? 0) + 1);
  }

  const largest = [...byVehicleLine.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!largest || largest[1] < MIN_CLUSTER_FOR_OPPORTUNITY_CARD) return null;

  const [product, count] = largest;
  return { type: "OPORTUNIDAD", text: `${count} clientes preguntaron por ${product} pero no han recibido seguimiento.` };
}

/** The product with the strongest genuine growth this period — phrased honestly against the ACTUAL window computed (30 days), never "esta semana" unless that's really what was measured. */
export function deriveTrendCard(productPerformance: ProductPerformanceSummary): InsightCard | null {
  const candidates = productPerformance.products.filter((p) => p.interested >= MIN_INTERESTED_FOR_TREND && p.trendPercent !== null && p.trendPercent >= MIN_TREND_PERCENT_FOR_CARD);
  if (candidates.length === 0) return null;

  const top = [...candidates].sort((a, b) => (b.trendPercent ?? 0) - (a.trendPercent ?? 0))[0];
  return { type: "TENDENCIA", text: `Las consultas sobre ${top.product} aumentaron ${top.trendPercent}% en el último mes.` };
}

/** A direct pass-through of loss-analysis.ts's own gated insight — this file never re-derives the response-time comparison, only reuses it. */
export function deriveProblemCard(lossAnalysis: LossAnalysis): InsightCard | null {
  if (!lossAnalysis.responseTimeInsight) return null;
  return { type: "PROBLEMA", text: lossAnalysis.responseTimeInsight };
}

export function deriveInsightCards(productPerformance: ProductPerformanceSummary, lossAnalysis: LossAnalysis, needsOutcomeNudges: KoriNeedsOutcomeNudge[]): InsightCard[] {
  return [deriveOpportunityCard(needsOutcomeNudges), deriveTrendCard(productPerformance), deriveProblemCard(lossAnalysis)]
    .filter((card): card is InsightCard => card !== null)
    .slice(0, MAX_INSIGHT_CARDS);
}

export function buildExecutiveSummary(
  commercialConversations: number,
  productPerformance: ProductPerformanceSummary,
  lossAnalysis: LossAnalysis,
  needsOutcomeCount: number,
): string {
  const parts: string[] = [];

  parts.push(`Recibimos ${commercialConversations} ${commercialConversations === 1 ? "conversación comercial" : "conversaciones comerciales"} este mes.`);

  const trending = productPerformance.products
    .filter((p) => p.interested >= MIN_INTERESTED_FOR_TREND && p.trendPercent !== null && p.trendPercent > 0)
    .sort((a, b) => (b.trendPercent ?? 0) - (a.trendPercent ?? 0))[0];
  if (trending) parts.push(`El producto con mayor crecimiento fue ${trending.product} (+${trending.trendPercent}%).`);

  const topLostReason = lossAnalysis.lostReasonBreakdown[0];
  if (topLostReason) parts.push(`La principal razón de pérdida fue ${topLostReason.label.toLowerCase()}.`);

  if (needsOutcomeCount > 0) parts.push(`Hay ${needsOutcomeCount} ${needsOutcomeCount === 1 ? "cliente" : "clientes"} con alta intención sin seguimiento.`);

  return parts.join(" ");
}

const MAX_PRODUCTS_DISPLAYED = 5;

export interface GetKoriInsightsContext {
  commercialConversations: number;
  needsOutcomeNudges: KoriNeedsOutcomeNudge[];
}

export async function getKoriInsights(businessId: string, now: Date, context: GetKoriInsightsContext): Promise<KoriInsightsSummary> {
  const [productPerformance, lossAnalysis] = await Promise.all([getProductPerformance(businessId, now), getLossAnalysis(businessId, now)]);

  return {
    executiveSummary: buildExecutiveSummary(context.commercialConversations, productPerformance, lossAnalysis, context.needsOutcomeNudges.length),
    cards: deriveInsightCards(productPerformance, lossAnalysis, context.needsOutcomeNudges),
    productPerformance: productPerformance.products.slice(0, MAX_PRODUCTS_DISPLAYED),
    periodDays: productPerformance.periodDays,
  };
}
