// Kori Commercial Intelligence V2 — Fase C. Builds the Spanish answer for
// one of Kori's three known strategic questions, entirely from real
// numbers already computed by the Business Insights Engine (server/insights)
// and kori-briefing-service.ts — never a second free-text AI call. Same
// rule as every other answer Kori has ever produced: the sentence can never
// say anything the underlying data doesn't actually support.

import { prisma } from "@/server/db/client";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";
import { getProductPerformance, type ProductPerformanceSummary } from "@/server/insights/product-performance";
import { getLossAnalysis, type LossAnalysis } from "@/server/insights/loss-analysis";
import { groupLeadsByOperationalActionState } from "./conversation-action-state-service";
import { deriveNeedsOutcomeNudges } from "./kori-briefing-service";
import type { StrategicIntent } from "@/server/kori/strategic-intent-classifier";

const MIN_INTERESTED_FOR_RECOMMENDATION = 3;
/** A lost reason only gets called out as "the" weakness once it accounts for at least this share of losses — otherwise losses are too spread out to name one cause. */
const MIN_DOMINANT_LOST_REASON_PERCENT = 50;
/** Fewer than this many undecided high-intent leads isn't "the" weakness — it's normal operational noise. */
const MIN_NEEDS_OUTCOME_COUNT_FOR_WEAKNESS = 3;

export function buildTopOpportunityAnswer(productPerformance: ProductPerformanceSummary): string {
  const opportunity = productPerformance.products.find((p) => p.classification === "OPORTUNIDAD_MEJORA");
  if (opportunity) {
    const conversionPct = Math.round((opportunity.conversionRate ?? 0) * 100);
    return `Basado en conversaciones y resultados, ${opportunity.product} tiene mayor potencial: alta demanda pero solo ${conversionPct}% de conversión — hay margen real de mejora ahí.`;
  }

  const star = productPerformance.products.find((p) => p.classification === "ESTRELLA");
  if (star) {
    const conversionPct = Math.round((star.conversionRate ?? 0) * 100);
    return `${star.product} ya es tu producto más fuerte, con alta demanda y ${conversionPct}% de conversión — seguir invirtiendo ahí es una apuesta segura.`;
  }

  return "Todavía no hay suficiente información sobre productos y resultados este mes para recomendar uno en particular.";
}

export function buildMainWeaknessAnswer(needsOutcomeCount: number, lossAnalysis: LossAnalysis): string {
  if (needsOutcomeCount >= MIN_NEEDS_OUTCOME_COUNT_FOR_WEAKNESS) {
    return `El principal punto débil es el seguimiento: ${needsOutcomeCount} clientes con intención alta no tienen un resultado registrado todavía.`;
  }

  if (lossAnalysis.responseTimeInsight) {
    return lossAnalysis.responseTimeInsight;
  }

  const topReason = lossAnalysis.lostReasonBreakdown[0];
  if (topReason && topReason.percentage >= MIN_DOMINANT_LOST_REASON_PERCENT) {
    return `La mayoría de las ventas perdidas (${topReason.percentage}%) son por ${topReason.label.toLowerCase()} — ahí está el mayor punto de mejora.`;
  }

  return "No se detectó un problema dominante todavía — los resultados de este mes están relativamente parejos.";
}

export function buildWhereToInvestAnswer(productPerformance: ProductPerformanceSummary): string {
  const stars = productPerformance.products.filter((p) => p.classification === "ESTRELLA").slice(0, 2);
  if (stars.length > 0) {
    return `Los datos muestran mayor intención combinada con buena conversión en ${stars.map((p) => p.product).join(" y ")}.`;
  }

  const topByInterest = productPerformance.products.filter((p) => p.interested >= MIN_INTERESTED_FOR_RECOMMENDATION).slice(0, 2);
  if (topByInterest.length > 0) {
    return `Los datos muestran mayor interés en ${topByInterest.map((p) => p.product).join(" y ")}, aunque todavía no hay suficientes ventas decididas para confirmar la conversión.`;
  }

  return "Todavía no hay suficiente información para recomendar dónde invertir.";
}

/**
 * A narrower re-derivation of kori-briefing-service.ts's own
 * needsOutcomeNudges wiring (groupLeadsByOperationalActionState +
 * outcome-conversationId set -> deriveNeedsOutcomeNudges), NOT a call to
 * getKoriBriefing itself: that function predates this service, has no `db`
 * injection seam of its own, and computes several other things (decisions,
 * demand signals, stats) MAIN_WEAKNESS doesn't need. The actual nudge LOGIC
 * still lives in exactly one place — deriveNeedsOutcomeNudges, imported
 * here, never redefined.
 */
async function countNeedsOutcomeLeads(businessId: string, now: Date, db: PrismaClientOrTransaction): Promise<number> {
  const [actionGroups, conversationIdsWithOutcome] = await Promise.all([
    groupLeadsByOperationalActionState(businessId, db),
    db.outcome.findMany({ where: { businessId }, select: { conversationId: true } }).then((rows) => new Set(rows.map((r) => r.conversationId))),
  ]);
  const allActionEntries = [...actionGroups.replyRequired, ...actionGroups.followUpRequired, ...actionGroups.waitingOnCustomer];
  return deriveNeedsOutcomeNudges(allActionEntries, conversationIdsWithOutcome, now).length;
}

/** Fetches only what each intent actually needs — never the full Business Insights Engine for a question that only needs one piece of it. */
export async function answerStrategicQuestion(businessId: string, intent: StrategicIntent, now: Date, db: PrismaClientOrTransaction = prisma): Promise<string> {
  switch (intent) {
    case "TOP_OPPORTUNITY_PRODUCT":
      return buildTopOpportunityAnswer(await getProductPerformance(businessId, now, db));
    case "WHERE_TO_INVEST":
      return buildWhereToInvestAnswer(await getProductPerformance(businessId, now, db));
    case "MAIN_WEAKNESS": {
      const [lossAnalysis, needsOutcomeCount] = await Promise.all([getLossAnalysis(businessId, now, db), countNeedsOutcomeLeads(businessId, now, db)]);
      return buildMainWeaknessAnswer(needsOutcomeCount, lossAnalysis);
    }
  }
}
