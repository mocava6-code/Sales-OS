// Deepens what conversion-intelligence-service.ts's topLostReasons already
// shows (capped at 3, no percentages) into a full breakdown, and answers a
// question nothing in this codebase could answer before this layer: does
// response speed actually correlate with whether a sale closes or is lost.

import { prisma } from "@/server/db/client";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";
import { LOST_REASON_LABELS, type LostReason } from "@/lib/validations/outcome";
import { INSIGHTS_PERIOD_DAYS } from "./constants";
import {
  bucketForResponseMinutes,
  fetchFirstResponseMinutesByConversationId,
  RESPONSE_TIME_BUCKETS,
  RESPONSE_TIME_BUCKET_LABELS,
  type ResponseTimeBucketKey,
} from "./response-time";

export interface LossReasonBreakdown {
  reason: LostReason;
  label: string;
  count: number;
  percentage: number;
}

export interface ResponseTimeBucketStat {
  bucket: ResponseTimeBucketKey;
  label: string;
  decided: number;
  closed: number;
  conversionRate: number | null;
}

export interface LossAnalysis {
  totalLost: number;
  lostReasonBreakdown: LossReasonBreakdown[];
  responseTimeBuckets: ResponseTimeBucketStat[];
  /** A grounded, gated comparison sentence — null whenever the fastest/slowest buckets don't have enough decided volume, or fast isn't actually better. */
  responseTimeInsight: string | null;
}

export function deriveLossReasonBreakdown(lostOutcomes: { lostReason: string | null }[]): LossReasonBreakdown[] {
  const withReason = lostOutcomes.filter((o): o is { lostReason: string } => o.lostReason !== null);
  const total = withReason.length;

  const counts = new Map<LostReason, number>();
  for (const outcome of withReason) {
    const reason = outcome.lostReason as LostReason;
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, label: LOST_REASON_LABELS[reason], count, percentage: total > 0 ? Math.round((count / total) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);
}

export function deriveResponseTimeBuckets(decidedOutcomes: { outcomeType: "SALE_CLOSED" | "SALE_LOST"; responseMinutes: number | null }[]): ResponseTimeBucketStat[] {
  const tallies = new Map<ResponseTimeBucketKey, { decided: number; closed: number }>();
  for (const outcome of decidedOutcomes) {
    if (outcome.responseMinutes === null) continue;
    const bucket = bucketForResponseMinutes(outcome.responseMinutes);
    const tally = tallies.get(bucket) ?? { decided: 0, closed: 0 };
    tally.decided += 1;
    if (outcome.outcomeType === "SALE_CLOSED") tally.closed += 1;
    tallies.set(bucket, tally);
  }

  return RESPONSE_TIME_BUCKETS.map((bucket) => {
    const tally = tallies.get(bucket) ?? { decided: 0, closed: 0 };
    return {
      bucket,
      label: RESPONSE_TIME_BUCKET_LABELS[bucket],
      decided: tally.decided,
      closed: tally.closed,
      conversionRate: tally.decided > 0 ? tally.closed / tally.decided : null,
    };
  });
}

/** Neither bucket may have fewer decided outcomes than this — a comparison between two thin samples is not a pattern. */
const MIN_DECIDED_PER_BUCKET_FOR_INSIGHT = 3;

export function buildResponseTimeInsight(buckets: ResponseTimeBucketStat[]): string | null {
  const fast = buckets.find((b) => b.bucket === "UNDER_30_MIN");
  const slow = buckets.find((b) => b.bucket === "OVER_24H");
  if (!fast || !slow) return null;
  if (fast.decided < MIN_DECIDED_PER_BUCKET_FOR_INSIGHT || slow.decided < MIN_DECIDED_PER_BUCKET_FOR_INSIGHT) return null;
  if (fast.conversionRate === null || slow.conversionRate === null) return null;
  if (fast.conversionRate <= slow.conversionRate) return null;

  const fastPct = Math.round(fast.conversionRate * 100);
  const slowPct = Math.round(slow.conversionRate * 100);
  return `Los clientes que reciben respuesta en menos de 30 minutos convierten ${fastPct}% de las veces, frente a ${slowPct}% cuando la respuesta toma más de 24 horas.`;
}

export async function getLossAnalysis(businessId: string, now: Date = new Date(), db: PrismaClientOrTransaction = prisma): Promise<LossAnalysis> {
  const periodStart = new Date(now.getTime() - INSIGHTS_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  const decidedOutcomes = await db.outcome.findMany({
    where: { businessId, outcomeType: { in: ["SALE_CLOSED", "SALE_LOST"] }, occurredAt: { gte: periodStart, lte: now } },
    select: { outcomeType: true, lostReason: true, conversationId: true },
  });

  const responseMinutesByConversationId = await fetchFirstResponseMinutesByConversationId([...new Set(decidedOutcomes.map((o) => o.conversationId))], db);

  const responseTimeBuckets = deriveResponseTimeBuckets(
    decidedOutcomes.map((o) => ({
      outcomeType: o.outcomeType as "SALE_CLOSED" | "SALE_LOST",
      responseMinutes: responseMinutesByConversationId.get(o.conversationId) ?? null,
    })),
  );

  const lostOutcomes = decidedOutcomes.filter((o) => o.outcomeType === "SALE_LOST");

  return {
    totalLost: lostOutcomes.length,
    lostReasonBreakdown: deriveLossReasonBreakdown(lostOutcomes),
    responseTimeBuckets,
    responseTimeInsight: buildResponseTimeInsight(responseTimeBuckets),
  };
}
