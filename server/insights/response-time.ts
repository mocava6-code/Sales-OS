// Time-to-first-response — computed fresh from ConversationEntry on every
// read, never persisted. No field or service in this codebase calculated
// this before the Business Insights Engine (confirmed by audit); it is the
// one genuinely new primitive the loss-analysis and team-performance
// insights both depend on.

import { prisma } from "@/server/db/client";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";
import { INSIGHTS_FETCH_CAP } from "./constants";

export interface ResponseTimeEntry {
  direction: "INBOUND" | "OUTBOUND";
  occurredAt: Date;
}

/**
 * Minutes between a conversation's first inbound message and the first
 * outbound message that follows it — null when there's no inbound message,
 * or no outbound reply has been sent yet (an unanswered conversation has no
 * response time, not a response time of Infinity or 0).
 */
export function computeFirstResponseMinutes(entries: ResponseTimeEntry[]): number | null {
  const sorted = [...entries].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const firstInbound = sorted.find((e) => e.direction === "INBOUND");
  if (!firstInbound) return null;

  const firstResponse = sorted.find((e) => e.direction === "OUTBOUND" && e.occurredAt.getTime() >= firstInbound.occurredAt.getTime());
  if (!firstResponse) return null;

  return (firstResponse.occurredAt.getTime() - firstInbound.occurredAt.getTime()) / (60 * 1000);
}

export const RESPONSE_TIME_BUCKETS = ["UNDER_30_MIN", "30_MIN_TO_2H", "2H_TO_24H", "OVER_24H"] as const;
export type ResponseTimeBucketKey = (typeof RESPONSE_TIME_BUCKETS)[number];

export const RESPONSE_TIME_BUCKET_LABELS: Record<ResponseTimeBucketKey, string> = {
  UNDER_30_MIN: "menos de 30 minutos",
  "30_MIN_TO_2H": "entre 30 minutos y 2 horas",
  "2H_TO_24H": "entre 2 y 24 horas",
  OVER_24H: "más de 24 horas",
};

export function bucketForResponseMinutes(minutes: number): ResponseTimeBucketKey {
  if (minutes < 30) return "UNDER_30_MIN";
  if (minutes < 120) return "30_MIN_TO_2H";
  if (minutes < 1440) return "2H_TO_24H";
  return "OVER_24H";
}

/**
 * First-response minutes for a bounded set of conversations, one query
 * regardless of how many conversations are asked for — never N+1. Ordered
 * ascending (oldest first) since first-response only ever cares about the
 * START of a conversation, the opposite of every "recent window" fetch
 * elsewhere in this codebase.
 */
export async function fetchFirstResponseMinutesByConversationId(
  conversationIds: string[],
  db: PrismaClientOrTransaction = prisma,
): Promise<Map<string, number | null>> {
  if (conversationIds.length === 0) return new Map();

  const entries = await db.conversationEntry.findMany({
    where: { conversationId: { in: conversationIds } },
    orderBy: { occurredAt: "asc" },
    select: { conversationId: true, direction: true, occurredAt: true },
    take: INSIGHTS_FETCH_CAP,
  });

  const byConversation = new Map<string, ResponseTimeEntry[]>();
  for (const entry of entries) {
    const list = byConversation.get(entry.conversationId) ?? [];
    list.push({ direction: entry.direction, occurredAt: entry.occurredAt });
    byConversation.set(entry.conversationId, list);
  }

  const result = new Map<string, number | null>();
  for (const conversationId of conversationIds) {
    result.set(conversationId, computeFirstResponseMinutes(byConversation.get(conversationId) ?? []));
  }
  return result;
}
