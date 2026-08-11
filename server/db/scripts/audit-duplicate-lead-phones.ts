import "dotenv/config";
import { fileURLToPath } from "node:url";
import { prisma } from "../client";
import type { PrismaClient } from "../generated/client";
import { normalizePhoneToE164 } from "../../../lib/phone";

// Kori Data Correctness Phase 1 — REMEDIATION PLAN ONLY. This script is
// strictly READ-ONLY: it never creates, updates, or deletes a single row.
// It exists to answer one question before any merge/dedup work is even
// designed in detail: how many candidate duplicate Lead groups actually
// exist in production, and what's attached to each (conversations,
// follow-ups, a commercial profile, an assigned agent) — the information a
// human needs to decide a merge survivor per group. Groups Leads within
// the same business by their phone normalized to E.164 (lib/phone.ts) —
// the exact canonical form Phase 1D's new-write normalization now uses,
// so a duplicate found here is a duplicate under the NEW representation
// too, not an artifact of comparing two different formats.
//
// Usage (read-only — safe to run against any environment, including
// production, since it issues nothing but SELECTs):
//   npx tsx server/db/scripts/audit-duplicate-lead-phones.ts [--business=Koriaki]
// Omit --business to scan every business.

export interface DuplicateLeadPhoneGroupMember {
  leadId: string;
  name: string;
  /** Exactly as stored today — never rewritten by this script. */
  rawPhone: string;
  conversationCount: number;
  followUpCount: number;
  hasCommercialProfile: boolean;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  createdAt: Date;
}

export interface DuplicateLeadPhoneGroup {
  businessId: string;
  normalizedPhone: string;
  leads: DuplicateLeadPhoneGroupMember[];
}

export interface AuditDuplicateLeadPhonesResult {
  scannedLeadCount: number;
  /** A stored phone that fails to normalize (pre-dates Phase 1D, or was hand-entered as garbage) — counted, never silently dropped or guessed at, and never grouped with anything. */
  unparseablePhoneCount: number;
  duplicateGroups: DuplicateLeadPhoneGroup[];
}

/**
 * READ-ONLY: a single db.lead.findMany() and nothing else. Groups leads by
 * (businessId, normalizedPhone) and returns only groups with more than one
 * Lead — the candidate duplicates. Pass `businessId` to scope to one
 * business; omit to scan every business (still correctly scoped per group,
 * since the grouping key includes businessId).
 */
export async function auditDuplicateLeadPhones(db: PrismaClient = prisma, businessId?: string): Promise<AuditDuplicateLeadPhonesResult> {
  const leads = await db.lead.findMany({
    where: businessId ? { businessId } : undefined,
    select: {
      id: true,
      businessId: true,
      name: true,
      phone: true,
      createdAt: true,
      assignedToUserId: true,
      assignedTo: { select: { name: true } },
      commercialProfile: { select: { id: true } },
      _count: { select: { conversations: true, followUps: true } },
    },
  });

  const groups = new Map<string, DuplicateLeadPhoneGroup>();
  let unparseablePhoneCount = 0;

  for (const lead of leads) {
    let normalizedPhone: string;
    try {
      normalizedPhone = normalizePhoneToE164(lead.phone);
    } catch {
      unparseablePhoneCount++;
      continue;
    }

    const key = `${lead.businessId}::${normalizedPhone}`;
    const member: DuplicateLeadPhoneGroupMember = {
      leadId: lead.id,
      name: lead.name,
      rawPhone: lead.phone,
      conversationCount: lead._count.conversations,
      followUpCount: lead._count.followUps,
      hasCommercialProfile: lead.commercialProfile !== null,
      assignedAgentId: lead.assignedToUserId,
      assignedAgentName: lead.assignedTo?.name ?? null,
      createdAt: lead.createdAt,
    };

    const existing = groups.get(key);
    if (existing) {
      existing.leads.push(member);
    } else {
      groups.set(key, { businessId: lead.businessId, normalizedPhone, leads: [member] });
    }
  }

  const duplicateGroups = [...groups.values()].filter((group) => group.leads.length > 1);

  return { scannedLeadCount: leads.length, unparseablePhoneCount, duplicateGroups };
}

function formatReport(result: AuditDuplicateLeadPhonesResult): string {
  const lines: string[] = [];
  lines.push(`Scanned ${result.scannedLeadCount} leads. ${result.unparseablePhoneCount} had an unparseable phone (excluded from grouping).`);
  lines.push(`Found ${result.duplicateGroups.length} candidate duplicate phone group(s).`);
  lines.push("");

  for (const group of result.duplicateGroups) {
    lines.push(`businessId=${group.businessId} normalizedPhone=${group.normalizedPhone} (${group.leads.length} leads)`);
    for (const lead of group.leads) {
      lines.push(
        `  leadId=${lead.leadId} name="${lead.name}" rawPhone=${lead.rawPhone} conversations=${lead.conversationCount} ` +
          `followUps=${lead.followUpCount} commercialProfile=${lead.hasCommercialProfile} ` +
          `assignedAgent=${lead.assignedAgentName ?? "(unassigned)"} createdAt=${lead.createdAt.toISOString()}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (const raw of argv) {
    const withValue = /^--([^=]+)=(.*)$/.exec(raw);
    if (withValue) {
      args[withValue[1]] = withValue[2];
      continue;
    }
    const flag = /^--(.+)$/.exec(raw);
    if (flag) args[flag[1]] = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const businessName = typeof args.business === "string" ? args.business : undefined;

  let businessId: string | undefined;
  if (businessName) {
    const business = await prisma.business.findUnique({ where: { name: businessName } });
    if (!business) {
      throw new Error(`No business named "${businessName}" found. Nothing was read.`);
    }
    businessId = business.id;
  }

  console.log(
    `Auditing duplicate Lead phone numbers${businessName ? ` for "${businessName}"` : " across all businesses"} — READ-ONLY, no writes.`,
  );

  const result = await auditDuplicateLeadPhones(prisma, businessId);
  console.log(formatReport(result));
}

// Same guard as backfill-lead-commercial-profiles.ts — importing
// auditDuplicateLeadPhones (e.g. from this file's own test suite) must
// never trigger the CLI entrypoint as a side effect.
const isDirectlyExecuted = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectlyExecuted) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
