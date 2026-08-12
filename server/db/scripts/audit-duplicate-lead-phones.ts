import "dotenv/config";
import { fileURLToPath } from "node:url";
import { prisma } from "../client";
import type { ConversationStatus, CustomerTypeProfile, LeadNextAction, LeadPriority, LeadStatus, PrismaClient } from "../generated/client";
import { normalizeStoredPhoneForAudit } from "../../../lib/phone";
import { isPlaceholderName } from "../../services/lead-service";

// Kori Legacy Data Remediation v0 — Phase A (production duplicate audit) +
// Phase B (survivor recommendation). This script is strictly READ-ONLY: it
// never creates, updates, or deletes a single row, and it never merges,
// deletes, or rewrites a phone number. It exists to answer, with full
// per-lead context, exactly which legacy Lead rows represent the same real
// customer under the canonical E.164 phone, and which one a human should
// keep, WITHOUT applying that decision.
//
// Grouping uses lib/phone.ts's normalizeStoredPhoneForAudit — NOT the same
// normalizePhoneToE164 Phase 1D's new-write path uses. A stored `phone`
// here may predate Phase 1D and be in any format (WhatsApp's raw digits
// with no leading "+", a human-typed Peru national number, or already
// canonical "+"-prefixed international) with no way to know which from the
// string alone, so this tries all three interpretations — see that
// function's doc comment for why a single fixed-format normalizer
// undercounts real duplicates on historical data.
//
// Usage (read-only — safe to run against any environment, including
// production, since it issues nothing but SELECTs):
//   npx tsx server/db/scripts/audit-duplicate-lead-phones.ts [--business=Koriaki]
// Omit --business to scan every business.

export interface CommercialProfileSnapshot {
  vehicleBrand: string | null;
  vehicleModel: string | null;
  vehicleYear: number | null;
  productInterest: string | null;
  customerType: CustomerTypeProfile | null;
  nextAction: LeadNextAction | null;
  primaryObjection: string | null;
}

export interface DuplicateLeadPhoneGroupMember {
  leadId: string;
  name: string;
  /** Exactly as stored today — never rewritten by this script. */
  rawPhone: string;
  status: LeadStatus;
  priority: LeadPriority;
  createdAt: Date;
  // Kori Legacy Data Remediation v0: Lead has no `updatedAt` column in the
  // current schema (server/db/schema.prisma) — adding one is a migration,
  // out of scope for a read-only audit. `lastContactAt` is the closest
  // existing signal of "last touched" and is reported instead.
  lastContactAt: Date | null;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  conversationCount: number;
  latestConversationLastEntryAt: Date | null;
  latestConversationStatus: ConversationStatus | null;
  followUpCount: number;
  openFollowUpCount: number;
  outcomeCount: number;
  hasCommercialProfile: boolean;
  commercialProfile: CommercialProfileSnapshot | null;
}

export interface SurvivorRecommendation {
  recommendedSurvivorLeadId: string;
  loserLeadIds: string[];
  survivorReasonSummary: string;
}

export interface DuplicateLeadPhoneGroup {
  businessId: string;
  normalizedPhone: string;
  leads: DuplicateLeadPhoneGroupMember[];
  /** Phase B — a recommendation only. Nothing in this script ever applies it. */
  survivorRecommendation: SurvivorRecommendation;
}

export interface AuditDuplicateLeadPhonesResult {
  scannedLeadCount: number;
  /** A stored phone that fails to normalize (pre-dates Phase 1D, or was hand-entered as garbage) — counted, never silently dropped or guessed at, and never grouped with anything. */
  unparseablePhoneCount: number;
  normalizedLeadCount: number;
  duplicateGroups: DuplicateLeadPhoneGroup[];
  /** Sum of (group.leads.length - 1) across every group — how many rows a future merge would eventually remove. */
  duplicateLeadRowsBeyondFirstSurvivor: number;
  /** Distinct businessIds that have at least one duplicate group. */
  businessesAffected: number;
}

/** Count of non-null commercial-profile fields — Phase B's "richer profile" tie-break input. 0 for a lead with no profile at all. */
export function commercialProfileRichness(profile: CommercialProfileSnapshot | null): number {
  if (!profile) return 0;
  return [
    profile.vehicleBrand,
    profile.vehicleModel,
    profile.vehicleYear,
    profile.productInterest,
    profile.customerType,
    profile.nextAction,
    profile.primaryObjection,
  ].filter((value) => value !== null && value !== undefined).length;
}

interface RankingCriterion {
  label: string;
  /** Higher score wins. */
  score: (member: DuplicateLeadPhoneGroupMember) => number;
}

// Phase B — exact order specified: name quality, conversation volume,
// commercial-profile richness, outcomes, follow-ups, assignment, age, then
// a stable final tie-break on leadId (handled separately, never by score).
//
// The first criterion is deliberately labeled "non-placeholder name," not
// "human-entered name" or "real name": isPlaceholderName() can only tell
// us a string isn't the exact phone-placeholder value
// findOrCreateLeadByPhone assigns a brand-new Lead. It has no way to know
// whether a non-placeholder string is an actual customer's name — a test
// artifact like "prueba" scores identically to a genuine name. Confirmed
// by a real production case where this criterion picked exactly that
// (server/db/scripts/audit-duplicate-lead-phones.db.test.ts's fixtures
// name this "María López"/"Juan Pérez" for readability, but the function
// itself makes no such judgment). This is precisely why every
// recommendation stays advisory — a human reviews it, nothing applies it
// automatically.
const SURVIVOR_RANKING_CRITERIA: RankingCriterion[] = [
  { label: "has a non-placeholder name", score: (m) => (isPlaceholderName(m.name, m.rawPhone) ? 0 : 1) },
  { label: "has more conversations", score: (m) => m.conversationCount },
  { label: "has a richer commercial profile", score: (m) => commercialProfileRichness(m.commercialProfile) },
  { label: "has more recorded outcomes", score: (m) => m.outcomeCount },
  { label: "has more follow-ups", score: (m) => m.followUpCount },
  { label: "is assigned to an agent", score: (m) => (m.assignedAgentId ? 1 : 0) },
  // Older createdAt wins; negating the timestamp keeps every criterion on
  // the same "higher score wins" convention.
  { label: "was created earlier (older lead)", score: (m) => -m.createdAt.getTime() },
];

function compareForSurvivorRank(a: DuplicateLeadPhoneGroupMember, b: DuplicateLeadPhoneGroupMember): number {
  for (const criterion of SURVIVOR_RANKING_CRITERIA) {
    const diff = criterion.score(b) - criterion.score(a);
    if (diff !== 0) return diff;
  }
  // Stable final tie-break — never arbitrary/insertion-order-dependent.
  return a.leadId.localeCompare(b.leadId);
}

function describeSurvivorReason(survivor: DuplicateLeadPhoneGroupMember, runnerUp: DuplicateLeadPhoneGroupMember): string {
  for (const criterion of SURVIVOR_RANKING_CRITERIA) {
    const survivorScore = criterion.score(survivor);
    const runnerUpScore = criterion.score(runnerUp);
    if (survivorScore !== runnerUpScore) {
      return `Recommended leadId=${survivor.leadId} over leadId=${runnerUp.leadId}: it ${criterion.label} (next-best candidate in this group).`;
    }
  }
  return `Recommended leadId=${survivor.leadId} — tied with leadId=${runnerUp.leadId} on every ranking criterion; broke the tie by lexicographically smallest leadId.`;
}

/**
 * Pure, deterministic, and read-only in the strongest sense — takes data
 * already fetched by auditDuplicateLeadPhones and computes ONLY a
 * recommendation, never touching the database. Kori Legacy Data
 * Remediation v0, Phase B: for a human to review before any future,
 * separate, explicitly-approved merge step exists.
 */
export function recommendSurvivor(members: DuplicateLeadPhoneGroupMember[]): SurvivorRecommendation {
  if (members.length === 0) {
    throw new Error("recommendSurvivor requires at least one candidate lead.");
  }

  const ranked = [...members].sort(compareForSurvivorRank);
  const [survivor, runnerUp] = ranked;
  const loserLeadIds = ranked.slice(1).map((m) => m.leadId);

  const survivorReasonSummary =
    ranked.length === 1 ? `Only candidate in this group (leadId=${survivor.leadId}).` : describeSurvivorReason(survivor, runnerUp);

  return { recommendedSurvivorLeadId: survivor.leadId, loserLeadIds, survivorReasonSummary };
}

/**
 * READ-ONLY: Lead/Outcome SELECTs only, nothing else. Groups leads by
 * (businessId, normalizedPhone) and returns only groups with more than one
 * Lead — the candidate duplicates — each with a Phase B survivor
 * recommendation attached. Pass `businessId` to scope to one business;
 * omit to scan every business (still correctly scoped per group, since the
 * grouping key includes businessId).
 */
export async function auditDuplicateLeadPhones(db: PrismaClient = prisma, businessId?: string): Promise<AuditDuplicateLeadPhonesResult> {
  const leads = await db.lead.findMany({
    where: businessId ? { businessId } : undefined,
    select: {
      id: true,
      businessId: true,
      name: true,
      phone: true,
      status: true,
      priority: true,
      createdAt: true,
      lastContactAt: true,
      assignedToUserId: true,
      assignedTo: { select: { name: true } },
      commercialProfile: {
        select: {
          vehicleBrand: true,
          vehicleModel: true,
          vehicleYear: true,
          productInterest: true,
          customerType: true,
          nextAction: true,
          primaryObjection: true,
        },
      },
      conversations: {
        orderBy: { lastEntryAt: "desc" },
        take: 1,
        select: { lastEntryAt: true, status: true },
      },
      followUps: { select: { status: true } },
      _count: { select: { conversations: true } },
    },
  });

  // Outcome has no direct Lead relation (Outcome -> DecisionRecord ->
  // Conversation -> Lead) — one bounded query, aggregated in memory.
  // Pilot-scale data volume only (see server/kori/query-executor.ts's own
  // documented limitation for the same join).
  const outcomeRows = await db.outcome.findMany({
    where: businessId ? { decisionRecord: { businessId } } : undefined,
    select: { decisionRecord: { select: { conversation: { select: { leadId: true } } } } },
  });
  const outcomeCountByLeadId = new Map<string, number>();
  for (const row of outcomeRows) {
    const leadId = row.decisionRecord.conversation.leadId;
    outcomeCountByLeadId.set(leadId, (outcomeCountByLeadId.get(leadId) ?? 0) + 1);
  }

  const groups = new Map<string, { businessId: string; normalizedPhone: string; leads: DuplicateLeadPhoneGroupMember[] }>();
  let unparseablePhoneCount = 0;

  for (const lead of leads) {
    let normalizedPhone: string;
    try {
      normalizedPhone = normalizeStoredPhoneForAudit(lead.phone);
    } catch {
      unparseablePhoneCount++;
      continue;
    }

    const latestConversation = lead.conversations[0] ?? null;
    const member: DuplicateLeadPhoneGroupMember = {
      leadId: lead.id,
      name: lead.name,
      rawPhone: lead.phone,
      status: lead.status,
      priority: lead.priority,
      createdAt: lead.createdAt,
      lastContactAt: lead.lastContactAt,
      assignedAgentId: lead.assignedToUserId,
      assignedAgentName: lead.assignedTo?.name ?? null,
      conversationCount: lead._count.conversations,
      latestConversationLastEntryAt: latestConversation?.lastEntryAt ?? null,
      latestConversationStatus: latestConversation?.status ?? null,
      followUpCount: lead.followUps.length,
      openFollowUpCount: lead.followUps.filter((f) => f.status === "PENDING").length,
      outcomeCount: outcomeCountByLeadId.get(lead.id) ?? 0,
      hasCommercialProfile: lead.commercialProfile !== null,
      commercialProfile: lead.commercialProfile,
    };

    const key = `${lead.businessId}::${normalizedPhone}`;
    const existing = groups.get(key);
    if (existing) {
      existing.leads.push(member);
    } else {
      groups.set(key, { businessId: lead.businessId, normalizedPhone, leads: [member] });
    }
  }

  const duplicateGroups: DuplicateLeadPhoneGroup[] = [...groups.values()]
    .filter((group) => group.leads.length > 1)
    .map((group) => ({ ...group, survivorRecommendation: recommendSurvivor(group.leads) }));

  const duplicateLeadRowsBeyondFirstSurvivor = duplicateGroups.reduce((sum, group) => sum + group.survivorRecommendation.loserLeadIds.length, 0);
  const businessesAffected = new Set(duplicateGroups.map((g) => g.businessId)).size;

  return {
    scannedLeadCount: leads.length,
    unparseablePhoneCount,
    normalizedLeadCount: leads.length - unparseablePhoneCount,
    duplicateGroups,
    duplicateLeadRowsBeyondFirstSurvivor,
    businessesAffected,
  };
}

function formatReport(result: AuditDuplicateLeadPhonesResult): string {
  const lines: string[] = [];
  lines.push("Kori Legacy Data Remediation v0 — READ-ONLY audit (no writes, no merges, no migrations).");
  lines.push("");
  lines.push("SUMMARY");
  lines.push(`  Leads scanned:                        ${result.scannedLeadCount}`);
  lines.push(`  Successfully normalized:              ${result.normalizedLeadCount}`);
  lines.push(`  Unparseable legacy phones (excluded):  ${result.unparseablePhoneCount}`);
  lines.push(`  Duplicate groups:                      ${result.duplicateGroups.length}`);
  lines.push(`  Duplicate rows beyond first survivor:  ${result.duplicateLeadRowsBeyondFirstSurvivor}`);
  lines.push(`  Businesses affected:                    ${result.businessesAffected}`);
  lines.push("");

  for (const group of result.duplicateGroups) {
    lines.push(`businessId=${group.businessId} canonicalPhone=${group.normalizedPhone} numberOfLeads=${group.leads.length}`);
    for (const lead of group.leads) {
      const cp = lead.commercialProfile;
      lines.push(`  leadId=${lead.leadId}`);
      lines.push(`    name="${lead.name}" rawPhone=${lead.rawPhone} status=${lead.status} priority=${lead.priority}`);
      lines.push(`    createdAt=${lead.createdAt.toISOString()} lastContactAt=${lead.lastContactAt?.toISOString() ?? "(never)"}`);
      lines.push(`    assignedAgent=${lead.assignedAgentName ?? "(unassigned)"} (${lead.assignedAgentId ?? "null"})`);
      lines.push(
        `    conversations=${lead.conversationCount} latestConversationLastEntryAt=${lead.latestConversationLastEntryAt?.toISOString() ?? "(none)"} latestConversationStatus=${lead.latestConversationStatus ?? "(none)"}`,
      );
      lines.push(`    followUps=${lead.followUpCount} (open=${lead.openFollowUpCount}) outcomes=${lead.outcomeCount}`);
      lines.push(
        `    commercialProfile=${lead.hasCommercialProfile ? "present" : "absent"}` +
          (cp
            ? ` vehicleBrand=${cp.vehicleBrand ?? "null"} vehicleModel=${cp.vehicleModel ?? "null"} vehicleYear=${cp.vehicleYear ?? "null"} productInterest=${cp.productInterest ?? "null"} customerType=${cp.customerType ?? "null"} nextAction=${cp.nextAction ?? "null"} primaryObjection=${cp.primaryObjection ?? "null"}`
            : ""),
      );
    }
    lines.push(`  Phase B recommendation:`);
    lines.push(`    recommendedSurvivorLeadId=${group.survivorRecommendation.recommendedSurvivorLeadId}`);
    lines.push(`    loserLeadIds=[${group.survivorRecommendation.loserLeadIds.join(", ")}]`);
    lines.push(`    reason: ${group.survivorRecommendation.survivorReasonSummary}`);
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
// auditDuplicateLeadPhones/recommendSurvivor (e.g. from this file's own
// test suite) must never trigger the CLI entrypoint as a side effect.
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
