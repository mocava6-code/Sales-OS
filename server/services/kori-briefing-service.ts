// Kori Commercial Intelligence Center v1 — the briefing shown on "/kori",
// the product's new front door. Deliberately a SYNTHESIS layer, not a new
// intelligence engine: every number here comes from a function that
// already exists and is already trusted elsewhere in the product
// (groupLeadsByOperationalActionState powers Today; the two GROUP_LEADS
// calls are the exact same Kori query engine a chat question would use).
// This file's only job is to compose and rank, never to invent a metric.

import { prisma } from "@/server/db/client";
import { groupLeadsByOperationalActionState, type TodayActionGroupEntry } from "./conversation-action-state-service";
import { listOverdueFollowUps } from "./follow-up-service";
import { listHighPriorityLeads } from "./lead-service";
import { listPendingDecisionsPreview, type PendingDecisionPreview } from "./decision-service";
import { executeKoriQuery } from "@/server/kori/query-executor";
import { parseKoriQuerySpec } from "@/server/kori/query-spec";
import { UNKNOWN_LABEL } from "@/lib/copy/labels";
import type { ActionReasonCode } from "@/server/intelligence/response-action/reason-codes";

const STALE_REPLY_HOURS = 48;
const DEMAND_WINDOW_DAYS = 7;
const MAX_OPPORTUNITIES = 5;
const MAX_DEMAND_SIGNALS = 5;
const NEEDS_OUTCOME_STALE_DAYS = 5;
const MAX_NEEDS_OUTCOME_NUDGES = 5;

/** Reason codes that mean "this is money on the table," not just "someone needs to reply." */
const BUYING_SIGNAL_REASON_CODES = new Set<ActionReasonCode>(["BUYING_SIGNAL", "DISCOUNT_REQUEST"]);
const STALLED_COMMITMENT_REASON_CODES = new Set<ActionReasonCode>([
  "ADVISOR_COMMITMENT_PENDING",
  "QUOTATION_PROMISED",
  "PAYMENT_CONFIRMATION_PENDING",
  "DELIVERY_CONFIRMATION_PENDING",
]);

/**
 * Kori Sales Memory v1's adoption nudge — the reason codes that mean real
 * buying intent was in motion (a signal, a promised quote, a decision the
 * customer was weighing) rather than routine back-and-forth. A lead stuck
 * here that's gone quiet almost certainly ended somehow — sale, loss, or
 * genuinely abandoned — and "Marcar resultado" is the fastest way to find
 * out which, closing Kori's own blind spot rather than just flagging it.
 */
const NEEDS_OUTCOME_REASON_CODES = new Set<ActionReasonCode>([
  "BUYING_SIGNAL",
  "DISCOUNT_REQUEST",
  "QUOTATION_PROMISED",
  "WAITING_FOR_CUSTOMER_DECISION",
  "ADVISOR_COMMITMENT_PENDING",
]);

export interface KoriOpportunity {
  leadId: string;
  leadName: string;
  vehicleLine: string | null;
  reasonCode: ActionReasonCode;
  kind: "buying_signal" | "stalled_commitment";
  waitingSince: Date | null;
}

export interface KoriNeedsOutcomeNudge {
  leadId: string;
  leadName: string;
  vehicleLine: string | null;
  reasonCode: ActionReasonCode;
  waitingSince: Date | null;
}

export interface KoriBriefing {
  stats: {
    replyRequiredCount: number;
    overdueFollowUpCount: number;
    newLeadsThisWeek: number;
    pendingDecisionsCount: number;
  };
  opportunities: KoriOpportunity[];
  alerts: { staleReplyCount: number; unassignedHighPriorityCount: number };
  pendingDecisions: PendingDecisionPreview[];
  needsOutcomeNudges: KoriNeedsOutcomeNudge[];
  demandSignals: { label: string; count: number; percentage: number }[];
  demandWindowDays: number;
  demandSampleSize: number;
}

function vehicleLineFor(entry: TodayActionGroupEntry): string | null {
  const vehicle = [entry.vehicleBrand, entry.vehicleModel].filter(Boolean).join(" ");
  return vehicle || entry.productInterest || null;
}

/**
 * Opportunities are entirely derived from the SAME groups Today already
 * shows — never a separate query, never a separate notion of "needs
 * action." Ranked buying signals first (closest to a sale), then stalled
 * commitments, oldest-waiting within each tier first.
 */
export function deriveOpportunities(entries: TodayActionGroupEntry[]): KoriOpportunity[] {
  const scored = entries
    .map((entry) => {
      const reasonCode = entry.reasonCode as ActionReasonCode;
      if (BUYING_SIGNAL_REASON_CODES.has(reasonCode)) {
        return { entry, reasonCode, kind: "buying_signal" as const, tier: 0 };
      }
      if (STALLED_COMMITMENT_REASON_CODES.has(reasonCode)) {
        return { entry, reasonCode, kind: "stalled_commitment" as const, tier: 1 };
      }
      return null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    const aTime = a.entry.lastActivityAt?.getTime() ?? 0;
    const bTime = b.entry.lastActivityAt?.getTime() ?? 0;
    return aTime - bTime; // oldest (longest-waiting) first
  });

  return scored.slice(0, MAX_OPPORTUNITIES).map(({ entry, reasonCode, kind }) => ({
    leadId: entry.leadId,
    leadName: entry.leadName || entry.leadPhone,
    vehicleLine: vehicleLineFor(entry),
    reasonCode,
    kind,
    waitingSince: entry.lastActivityAt,
  }));
}

export function countStaleReplies(entries: TodayActionGroupEntry[], now: Date): number {
  const staleThresholdMs = STALE_REPLY_HOURS * 60 * 60 * 1000;
  return entries.filter((entry) => entry.lastActivityAt !== null && now.getTime() - entry.lastActivityAt.getTime() >= staleThresholdMs).length;
}

/**
 * Kori Sales Memory v1's adoption nudge. A lead that showed real buying
 * intent (see NEEDS_OUTCOME_REASON_CODES), hasn't been touched in
 * NEEDS_OUTCOME_STALE_DAYS, and has never had an outcome recorded — Kori
 * genuinely doesn't know what happened to it. Distinct from opportunities
 * (act on this now, forward-looking) — this is "tell us what already
 * happened," so a lead never appears in both at once in practice (an
 * opportunity implies recent activity; this implies the opposite), but
 * the two are deliberately independent derivations, not mutually exclusive
 * by construction.
 */
export function deriveNeedsOutcomeNudges(entries: TodayActionGroupEntry[], conversationIdsWithOutcome: Set<string>, now: Date): KoriNeedsOutcomeNudge[] {
  const staleThresholdMs = NEEDS_OUTCOME_STALE_DAYS * 24 * 60 * 60 * 1000;

  return entries
    .filter((entry) => NEEDS_OUTCOME_REASON_CODES.has(entry.reasonCode as ActionReasonCode))
    .filter((entry) => entry.conversationId !== null && !conversationIdsWithOutcome.has(entry.conversationId))
    .filter((entry) => entry.lastActivityAt !== null && now.getTime() - entry.lastActivityAt.getTime() >= staleThresholdMs)
    .sort((a, b) => (a.lastActivityAt?.getTime() ?? 0) - (b.lastActivityAt?.getTime() ?? 0))
    .slice(0, MAX_NEEDS_OUTCOME_NUDGES)
    .map((entry) => ({
      leadId: entry.leadId,
      leadName: entry.leadName || entry.leadPhone,
      vehicleLine: vehicleLineFor(entry),
      reasonCode: entry.reasonCode as ActionReasonCode,
      waitingSince: entry.lastActivityAt,
    }));
}

interface DemandGroup { label: string; count: number }

async function fetchDemandGroups(businessId: string, groupBy: "vehicleBrand" | "productInterest", createdFrom: string): Promise<DemandGroup[]> {
  const spec = parseKoriQuerySpec({ operation: "GROUP_LEADS", groupBy, filters: { createdFrom } });
  const result = await executeKoriQuery({ businessId, querySpec: spec });
  if (result.type !== "grouped_result") return [];
  // "Sin información" (executeGroupLeads's fallback bucket for leads with no
  // commercial-profile value) is real data completeness, not a demand
  // signal — "most clients' interest is 'unknown'" isn't something to
  // highlight as trending. It's still a legitimate answer if a chat
  // question asks for the raw grouping (response-formatter.ts), just not
  // curated into this panel.
  return result.groups.filter((g) => g.key !== UNKNOWN_LABEL).map((g) => ({ label: g.key, count: g.count }));
}

export async function getKoriBriefing(businessId: string, now: Date = new Date()): Promise<KoriBriefing> {
  const demandWindowStart = new Date(now.getTime() - DEMAND_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const demandWindowStartIso = demandWindowStart.toISOString();

  const [actionGroups, overdueFollowUps, highPriorityLeads, leadsInWindow, pendingDecisions, pendingDecisionsCount, brandGroups, productGroups, conversationIdsWithOutcome] =
    await Promise.all([
      groupLeadsByOperationalActionState(businessId),
      listOverdueFollowUps(businessId),
      listHighPriorityLeads(businessId),
      prisma.lead.count({ where: { businessId, createdAt: { gte: demandWindowStart } } }),
      listPendingDecisionsPreview(businessId),
      prisma.decisionRecord.count({ where: { businessId, status: "PROPOSED" } }),
      fetchDemandGroups(businessId, "vehicleBrand", demandWindowStartIso),
      fetchDemandGroups(businessId, "productInterest", demandWindowStartIso),
      prisma.outcome.findMany({ where: { businessId }, select: { conversationId: true } }).then((rows) => new Set(rows.map((r) => r.conversationId))),
    ]);

  const actionableEntries = [...actionGroups.replyRequired, ...actionGroups.followUpRequired];
  const allActionEntries = [...actionableEntries, ...actionGroups.waitingOnCustomer];

  const demandSignals = [...brandGroups, ...productGroups]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_DEMAND_SIGNALS)
    .map((group) => ({
      label: group.label,
      count: group.count,
      percentage: leadsInWindow > 0 ? Math.round((group.count / leadsInWindow) * 100) : 0,
    }));

  return {
    stats: {
      replyRequiredCount: actionGroups.replyRequired.length,
      overdueFollowUpCount: overdueFollowUps.length,
      newLeadsThisWeek: leadsInWindow,
      pendingDecisionsCount,
    },
    opportunities: deriveOpportunities(actionableEntries),
    alerts: {
      staleReplyCount: countStaleReplies(actionGroups.replyRequired, now),
      unassignedHighPriorityCount: highPriorityLeads.filter((lead) => lead.assignedToUserId === null).length,
    },
    pendingDecisions,
    needsOutcomeNudges: deriveNeedsOutcomeNudges(allActionEntries, conversationIdsWithOutcome, now),
    demandSignals,
    demandWindowDays: DEMAND_WINDOW_DAYS,
    demandSampleSize: leadsInWindow,
  };
}

/**
 * The one-line "pulse" under the greeting. Deliberately a template filled
 * with numbers already computed above — never a second AI call, never
 * free text. It can't say anything the rest of the screen doesn't already
 * show, which is the whole point: a summary sentence that's wrong is worse
 * than no summary sentence.
 */
export function buildPulseSummary(
  briefing: Pick<KoriBriefing, "stats" | "alerts" | "demandSignals">,
  commercialConversationsThisMonth?: number,
): string {
  const { replyRequiredCount } = briefing.stats;
  const { staleReplyCount } = briefing.alerts;
  const topDemand = briefing.demandSignals[0];

  const parts: string[] = [];

  if (replyRequiredCount > 0) {
    const staleClause = staleReplyCount > 0 ? ` — ${staleReplyCount} ${staleReplyCount === 1 ? "lleva" : "llevan"} más de ${STALE_REPLY_HOURS} horas esperando` : "";
    parts.push(`${replyRequiredCount} ${replyRequiredCount === 1 ? "cliente requiere" : "clientes requieren"} respuesta ahora${staleClause}.`);
  } else {
    parts.push("Nadie requiere respuesta en este momento.");
  }

  if (commercialConversationsThisMonth !== undefined) {
    parts.push(`${commercialConversationsThisMonth} ${commercialConversationsThisMonth === 1 ? "conversación comercial" : "conversaciones comerciales"} este mes.`);
  }

  if (topDemand) {
    parts.push(`El interés en ${topDemand.label} sigue liderando esta semana.`);
  }

  return parts.join(" ");
}
