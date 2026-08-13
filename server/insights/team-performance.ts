// Cross-references an advisor's assigned leads with response time and
// outcomes — a join nothing in this codebase performed before this layer.
// Deliberately NEVER produces a ranking: every comparison is an advisor
// against the team's own average, never one advisor against another. This
// is a structural choice, not just a tone choice — see deriveTeamPerformance's
// own doc comment. The caller is responsible for restricting this data to
// OWNER-role viewers only (server/insights has no auth of its own).

import { prisma } from "@/server/db/client";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";
import { INSIGHTS_FETCH_CAP, INSIGHTS_PERIOD_DAYS } from "./constants";
import { fetchFirstResponseMinutesByConversationId } from "./response-time";

export interface AdvisorConversationRow {
  advisorUserId: string;
  advisorName: string;
  responseMinutes: number | null;
}

export interface AdvisorOutcomeRow {
  advisorUserId: string;
  outcomeType: "SALE_CLOSED" | "SALE_LOST";
}

export interface AdvisorPerformance {
  advisorUserId: string;
  advisorName: string;
  conversationsHandled: number;
  avgResponseTimeMinutes: number | null;
  decided: number;
  closed: number;
  conversionRate: number | null;
  /** A single, gated, team-average-relative sentence — null for most advisors, most of the time (nothing notable enough to say). */
  highlight: string | null;
}

export interface TeamAverage {
  avgResponseTimeMinutes: number | null;
  conversionRate: number | null;
}

export interface TeamPerformanceSummary {
  advisors: AdvisorPerformance[];
  teamAverage: TeamAverage;
  periodDays: number;
}

const MIN_DECIDED_FOR_HIGHLIGHT = 2;
/** An advisor's response time must be at least this much faster than the team average before it's called out — a 3% difference isn't a pattern. */
const NOTABLE_SPEED_MARGIN_PERCENT = 20;

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Every advisor is compared ONLY against teamAverage — never against
 * another named advisor. This is what keeps the output "learning," not a
 * leaderboard: the sentence is always "you vs. the team's own baseline,"
 * which is true for everyone at once and never puts one advisor's name
 * next to another's.
 */
export function deriveTeamPerformance(conversationRows: AdvisorConversationRow[], outcomeRows: AdvisorOutcomeRow[]): { advisors: AdvisorPerformance[]; teamAverage: TeamAverage } {
  const advisorNames = new Map<string, string>();
  const responseMinutesByAdvisor = new Map<string, number[]>();
  const conversationsByAdvisor = new Map<string, number>();

  for (const row of conversationRows) {
    advisorNames.set(row.advisorUserId, row.advisorName);
    conversationsByAdvisor.set(row.advisorUserId, (conversationsByAdvisor.get(row.advisorUserId) ?? 0) + 1);
    if (row.responseMinutes !== null) {
      const list = responseMinutesByAdvisor.get(row.advisorUserId) ?? [];
      list.push(row.responseMinutes);
      responseMinutesByAdvisor.set(row.advisorUserId, list);
    }
  }

  const outcomesByAdvisor = new Map<string, { decided: number; closed: number }>();
  for (const row of outcomeRows) {
    const tally = outcomesByAdvisor.get(row.advisorUserId) ?? { decided: 0, closed: 0 };
    tally.decided += 1;
    if (row.outcomeType === "SALE_CLOSED") tally.closed += 1;
    outcomesByAdvisor.set(row.advisorUserId, tally);
  }

  const allAdvisorIds = new Set([...advisorNames.keys(), ...outcomesByAdvisor.keys()]);

  const advisors: AdvisorPerformance[] = [...allAdvisorIds].map((advisorUserId) => {
    const outcomes = outcomesByAdvisor.get(advisorUserId) ?? { decided: 0, closed: 0 };
    return {
      advisorUserId,
      advisorName: advisorNames.get(advisorUserId) ?? "Sin nombre",
      conversationsHandled: conversationsByAdvisor.get(advisorUserId) ?? 0,
      avgResponseTimeMinutes: average(responseMinutesByAdvisor.get(advisorUserId) ?? []),
      decided: outcomes.decided,
      closed: outcomes.closed,
      conversionRate: outcomes.decided > 0 ? outcomes.closed / outcomes.decided : null,
      highlight: null,
    };
  });

  const teamAverage: TeamAverage = {
    avgResponseTimeMinutes: average([...responseMinutesByAdvisor.values()].flat()),
    conversionRate: (() => {
      const totals = [...outcomesByAdvisor.values()].reduce((acc, o) => ({ decided: acc.decided + o.decided, closed: acc.closed + o.closed }), { decided: 0, closed: 0 });
      return totals.decided > 0 ? totals.closed / totals.decided : null;
    })(),
  };

  for (const advisor of advisors) {
    advisor.highlight = buildAdvisorHighlight(advisor, teamAverage);
  }

  return { advisors: advisors.sort((a, b) => b.conversationsHandled - a.conversationsHandled), teamAverage };
}

function buildAdvisorHighlight(advisor: AdvisorPerformance, teamAverage: TeamAverage): string | null {
  if (advisor.decided < MIN_DECIDED_FOR_HIGHLIGHT) return null;

  const fasterPercent =
    advisor.avgResponseTimeMinutes !== null && teamAverage.avgResponseTimeMinutes !== null && teamAverage.avgResponseTimeMinutes > 0
      ? Math.round((1 - advisor.avgResponseTimeMinutes / teamAverage.avgResponseTimeMinutes) * 100)
      : null;
  const isNotablyFaster = fasterPercent !== null && fasterPercent >= NOTABLE_SPEED_MARGIN_PERCENT;

  const convertsBetter = advisor.conversionRate !== null && teamAverage.conversionRate !== null && advisor.conversionRate > teamAverage.conversionRate;

  if (isNotablyFaster && convertsBetter) {
    return `${advisor.advisorName} responde ${fasterPercent}% más rápido que el promedio del equipo, y convierte mejor.`;
  }
  if (convertsBetter) {
    const points = Math.round((advisor.conversionRate! - teamAverage.conversionRate!) * 100);
    return `${advisor.advisorName} convierte ${points} puntos porcentuales más que el promedio del equipo.`;
  }
  if (isNotablyFaster) {
    return `${advisor.advisorName} responde ${fasterPercent}% más rápido que el promedio del equipo.`;
  }
  return null;
}

export async function getTeamPerformance(businessId: string, now: Date = new Date(), db: PrismaClientOrTransaction = prisma): Promise<TeamPerformanceSummary> {
  const periodStart = new Date(now.getTime() - INSIGHTS_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  const leads = await db.lead.findMany({
    where: { businessId, assignedToUserId: { not: null } },
    select: {
      assignedToUserId: true,
      assignedTo: { select: { name: true } },
      conversations: { where: { lastEntryAt: { gte: periodStart, lte: now } }, select: { id: true } },
    },
    take: INSIGHTS_FETCH_CAP,
  });

  const conversationIds = leads.flatMap((lead) => lead.conversations.map((c) => c.id));
  const responseMinutesByConversationId = await fetchFirstResponseMinutesByConversationId(conversationIds, db);

  const conversationRows: AdvisorConversationRow[] = leads.flatMap((lead) =>
    lead.conversations.map((conversation) => ({
      advisorUserId: lead.assignedToUserId!,
      advisorName: lead.assignedTo!.name,
      responseMinutes: responseMinutesByConversationId.get(conversation.id) ?? null,
    })),
  );

  const outcomes = await db.outcome.findMany({
    where: {
      businessId,
      outcomeType: { in: ["SALE_CLOSED", "SALE_LOST"] },
      occurredAt: { gte: periodStart, lte: now },
      conversation: { lead: { assignedToUserId: { not: null } } },
    },
    select: { outcomeType: true, conversation: { select: { lead: { select: { assignedToUserId: true } } } } },
  });

  const outcomeRows: AdvisorOutcomeRow[] = outcomes.map((o) => ({
    advisorUserId: o.conversation.lead.assignedToUserId!,
    outcomeType: o.outcomeType as "SALE_CLOSED" | "SALE_LOST",
  }));

  const { advisors, teamAverage } = deriveTeamPerformance(conversationRows, outcomeRows);
  return { advisors, teamAverage, periodDays: INSIGHTS_PERIOD_DAYS };
}
