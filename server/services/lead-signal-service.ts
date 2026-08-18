// Business-facing view over the Observation Engine (server/intelligence/
// observation/**) for a single lead — distinct from server/observer-console/
// **, which is an internal, owner-only, read-only debugging surface never
// meant for a real salesperson. Same underlying Observation rows; this is
// the first place any end user sees them at all.
//
// Deliberately a plain read query (matches server/services/lead-service.ts's
// own convention), not a repository — nothing here writes, and nothing here
// needs the transactional guarantees server/persistence/** exists for.

import { prisma } from "@/server/db/client";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";
import type { Evidence } from "@/server/intelligence/types";
import type { ObservationType } from "@/server/intelligence/observation/types";

export interface LeadSignalSummary {
  type: ObservationType;
  count: number;
  lastOccurredAt: Date;
  /** The most recent occurrence's evidence excerpt, if any — never the full raw message. */
  latestExcerpt: string | null;
}

/**
 * Every distinct signal type observed for this lead across all its
 * conversations, most-recently-seen first. Small, bounded data per lead (a
 * handful of distinct types at most) — grouping in JS after one query is
 * simpler and just as correct as a database-side aggregate here, same
 * tradeoff server/insights/data-quality.ts makes for its own per-business
 * rollups.
 */
export async function getLeadSignals(leadId: string, businessId: string, db: PrismaClientOrTransaction = prisma): Promise<LeadSignalSummary[]> {
  const rows = await db.observation.findMany({
    where: { businessId, conversation: { leadId } },
    orderBy: { occurredAt: "desc" },
    select: { type: true, occurredAt: true, evidence: true },
  });

  const byType = new Map<ObservationType, LeadSignalSummary>();
  for (const row of rows) {
    const existing = byType.get(row.type);
    if (existing) {
      existing.count++;
      continue;
    }
    const evidence = row.evidence as unknown as Evidence[];
    byType.set(row.type, {
      type: row.type,
      count: 1,
      lastOccurredAt: row.occurredAt,
      latestExcerpt: evidence?.[0]?.excerpt ?? null,
    });
  }

  // Rows are already occurredAt desc, and a Map preserves first-insertion
  // order — so this is already sorted by most-recently-seen type, no
  // separate sort needed.
  return [...byType.values()];
}
