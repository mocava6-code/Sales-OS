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
import { getDataQualityStats, type DataQualityField, type DataQualityStat } from "@/server/insights/data-quality";
import type { KoriNeedsOutcomeNudge } from "./kori-briefing-service";

const MIN_INTERESTED_FOR_TREND = 3;
const MIN_TREND_PERCENT_FOR_CARD = 20;
const MIN_CLUSTER_FOR_OPPORTUNITY_CARD = 2;
const MAX_INSIGHT_CARDS = 5;
/** Below this many leads, a missing-data percentage is statistical noise, not a real pattern worth interrupting the owner about. */
const MIN_LEADS_FOR_DATA_QUALITY_CARD = 5;
const MIN_MISSING_PERCENT_FOR_DATA_QUALITY_CARD = 40;

const DATA_QUALITY_FIELD_LABELS: Record<DataQualityField, string> = {
  customerType: "el tipo de cliente",
  vehicleBrand: "la marca del vehículo",
  productInterest: "el producto de interés",
};

export type InsightCardType = "OPORTUNIDAD" | "TENDENCIA" | "PROBLEMA" | "DATO_FALTANTE";

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

/** Fase D — Data Quality Loop. Names the single most-incomplete field, never fabricates a value, and stays silent below the sample/severity thresholds — a business with clean data never sees this card. */
export function deriveDataQualityCard(stats: DataQualityStat[]): InsightCard | null {
  const eligible = stats.filter((s) => s.totalCount >= MIN_LEADS_FOR_DATA_QUALITY_CARD && s.missingPercentage >= MIN_MISSING_PERCENT_FOR_DATA_QUALITY_CARD);
  if (eligible.length === 0) return null;

  const worst = [...eligible].sort((a, b) => b.missingPercentage - a.missingPercentage)[0];
  return {
    type: "DATO_FALTANTE",
    text: `Kori necesita más información sobre ${DATA_QUALITY_FIELD_LABELS[worst.field]} — ${worst.missingPercentage}% de tus clientes no tienen este dato.`,
  };
}

export function deriveInsightCards(
  productPerformance: ProductPerformanceSummary,
  lossAnalysis: LossAnalysis,
  needsOutcomeNudges: KoriNeedsOutcomeNudge[],
  dataQualityStats: DataQualityStat[],
): InsightCard[] {
  return [deriveOpportunityCard(needsOutcomeNudges), deriveTrendCard(productPerformance), deriveProblemCard(lossAnalysis), deriveDataQualityCard(dataQualityStats)]
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
  const [productPerformance, lossAnalysis, dataQualityStats] = await Promise.all([
    getProductPerformance(businessId, now),
    getLossAnalysis(businessId, now),
    getDataQualityStats(businessId),
  ]);

  return {
    executiveSummary: buildExecutiveSummary(context.commercialConversations, productPerformance, lossAnalysis, context.needsOutcomeNudges.length),
    cards: deriveInsightCards(productPerformance, lossAnalysis, context.needsOutcomeNudges, dataQualityStats),
    productPerformance: productPerformance.products.slice(0, MAX_PRODUCTS_DISPLAYED),
    periodDays: productPerformance.periodDays,
  };
}
