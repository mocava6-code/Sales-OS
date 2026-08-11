import { prisma } from "@/server/db/client";
import type { Prisma } from "@/server/db/generated/client";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";
import { normalizeVehicleBrand, normalizeVehicleModel } from "./normalization";
import { parseKoriQuerySpec, type KoriLeadRow, type KoriQueryResult, type KoriQuerySpec } from "./query-spec";

// Kori Natural Language Analytics v0 — the deterministic query executor a
// future NL layer will call. Every query here is a plain Prisma
// query-builder call (findMany/count/groupBy over Lead/LeadCommercialProfile/
// Conversation/FollowUp/Outcome and their relations) — no $queryRaw,
// $executeRaw, or string-built SQL anywhere in this file, and no
// create/update/delete/upsert. businessId is only ever the function's own
// parameter, sourced by the caller from the authenticated server context —
// it is never read from querySpec (which is `.strict()`-validated and would
// reject a "businessId" key even if one were smuggled in).

type LeadFilters = KoriQuerySpec["filters"];

// Fetch-then-process-in-memory (grouping, non-native sort fields) is bounded
// by this cap rather than being truly unbounded — correct and fast at pilot
// scale (a handful of businesses, dozens-low hundreds of leads each); a
// business that outgrows this would need DB-level aggregation instead, a
// later optimization, not a correctness issue for this phase.
const IN_MEMORY_PROCESSING_FETCH_CAP = 1000;

const OVERDUE_FOLLOW_UP_CONDITION = { status: "PENDING" as const, dueAt: { lt: new Date() } };

/**
 * Every Lead-level constraint EXCEPT businessId (which the caller always
 * supplies separately — see buildLeadWhere / the nested `lead: {...}` uses
 * below) and, optionally: the overdueFollowUp condition (FOLLOW_UP_QUEUE
 * applies that directly against the FollowUp row it's already querying,
 * rather than nesting back through `lead.followUps`), and the createdAt
 * range (COUNT_OUTCOMES reuses the createdFrom/createdTo filter NAMES to
 * mean Outcome.occurredAt instead — applying them to Lead.createdAt too
 * would silently zero out results, since a lead's own creation date has no
 * reason to fall inside an outcome date range).
 */
function buildLeadFilterConditions(
  filters: LeadFilters,
  options: { includeOverdueFollowUpFilter?: boolean; includeCreatedAtFilter?: boolean } = {},
): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = {};
  if (!filters) return where;

  const commercialProfileWhere: Prisma.LeadCommercialProfileWhereInput = {};
  if (filters.vehicleBrand) commercialProfileWhere.vehicleBrand = { equals: normalizeVehicleBrand(filters.vehicleBrand), mode: "insensitive" };
  if (filters.vehicleModel) commercialProfileWhere.vehicleModel = { equals: normalizeVehicleModel(filters.vehicleModel), mode: "insensitive" };
  if (filters.vehicleYear !== undefined) commercialProfileWhere.vehicleYear = filters.vehicleYear;
  if (filters.productInterest) commercialProfileWhere.productInterest = { equals: filters.productInterest, mode: "insensitive" };
  if (filters.customerType) commercialProfileWhere.customerType = filters.customerType;
  if (Object.keys(commercialProfileWhere).length > 0) where.commercialProfile = commercialProfileWhere;

  // needsReply is deliberately NOT applied here. "Some conversation has
  // status NEEDS_REPLY" (a Prisma relation filter) is a different question
  // than "the lead's own most-recently-touched conversation has status
  // NEEDS_REPLY" (what toLeadRow displays as row.needsReply) — a Lead with
  // multiple Conversations (manual entry, historical import, and a live
  // WhatsApp thread are all separate creation paths that don't dedupe
  // against each other) can satisfy the former via an OLDER conversation
  // while its NEWEST conversation has a different status, producing a row
  // whose displayed needsReply contradicts the filter that selected it —
  // confirmed against a real production result. needsReply is instead
  // applied as a post-fetch filter on the same top-1-by-lastEntryAt
  // conversation toLeadRow already uses — see
  // fetchNeedsReplyFilteredLeadRows, shared by executeCountLeads,
  // executeListLeads, and executeFollowUpQueue so they can never disagree.
  const conversationsFilter: { some?: Prisma.ConversationWhereInput; none?: Prisma.ConversationWhereInput } = {};
  if (filters.lastActivityBefore || filters.lastActivityAfter) {
    const lastEntryAt: Prisma.DateTimeFilter = {};
    if (filters.lastActivityBefore) lastEntryAt.lt = new Date(filters.lastActivityBefore);
    if (filters.lastActivityAfter) lastEntryAt.gt = new Date(filters.lastActivityAfter);
    conversationsFilter.some = { ...conversationsFilter.some, lastEntryAt };
  }
  if (Object.keys(conversationsFilter).length > 0) where.conversations = conversationsFilter;

  if ((options.includeOverdueFollowUpFilter ?? true) && filters.overdueFollowUp !== undefined) {
    where.followUps = filters.overdueFollowUp ? { some: OVERDUE_FOLLOW_UP_CONDITION } : { none: OVERDUE_FOLLOW_UP_CONDITION };
  }

  if (filters.leadStatus) where.status = filters.leadStatus;
  if (filters.priority) where.priority = filters.priority;
  if (filters.assignedAgentId) where.assignedToUserId = filters.assignedAgentId;

  if ((options.includeCreatedAtFilter ?? true) && (filters.createdFrom || filters.createdTo)) {
    where.createdAt = {
      ...(filters.createdFrom ? { gte: new Date(filters.createdFrom) } : {}),
      ...(filters.createdTo ? { lte: new Date(filters.createdTo) } : {}),
    };
  }

  return where;
}

function buildLeadWhere(businessId: string, filters: LeadFilters): Prisma.LeadWhereInput {
  return { businessId, ...buildLeadFilterConditions(filters) };
}

const LEAD_ROW_INCLUDE = {
  commercialProfile: true,
  conversations: { orderBy: { lastEntryAt: "desc" as const }, take: 1 },
  followUps: { where: { status: { not: "DONE" as const } }, orderBy: { dueAt: "asc" as const }, take: 1 },
};

type LeadForRow = {
  id: string;
  name: string;
  phone: string;
  status: string;
  assignedToUserId: string | null;
  commercialProfile: { vehicleBrand: string | null; vehicleModel: string | null; productInterest: string | null; customerType: string | null } | null;
  conversations: { status: string; lastEntryAt: Date }[];
  followUps: { dueAt: Date }[];
};

function toLeadRow(lead: LeadForRow): KoriLeadRow {
  const activeConversation = lead.conversations[0] ?? null;
  const nextFollowUp = lead.followUps[0] ?? null;
  return {
    leadId: lead.id,
    name: lead.name,
    phone: lead.phone,
    vehicleBrand: lead.commercialProfile?.vehicleBrand ?? null,
    vehicleModel: lead.commercialProfile?.vehicleModel ?? null,
    productInterest: lead.commercialProfile?.productInterest ?? null,
    customerType: (lead.commercialProfile?.customerType as KoriLeadRow["customerType"]) ?? null,
    needsReply: activeConversation?.status === "NEEDS_REPLY",
    nextFollowUpDueAt: nextFollowUp ? nextFollowUp.dueAt.toISOString() : null,
    lastActivityAt: activeConversation ? activeConversation.lastEntryAt.toISOString() : null,
  };
}

function sortRowsInMemory(rows: KoriLeadRow[], sort: KoriQuerySpec["sort"]): KoriLeadRow[] {
  if (!sort) return rows;
  const factor = sort.direction === "asc" ? 1 : -1;
  const key = sort.field === "nextFollowUpDueAt" ? "nextFollowUpDueAt" : "lastActivityAt";
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === null && bv === null) return 0;
    if (av === null) return 1; // nulls last regardless of direction
    if (bv === null) return -1;
    return av < bv ? -factor : av > bv ? factor : 0;
  });
}

/**
 * The canonical needsReply-aware fetch: applies every WHERE-expressible
 * filter, then filters in application code by each lead's OWN
 * top-1-by-lastEntryAt conversation status — the exact same value
 * toLeadRow's `needsReply` field reports, so a row can never disagree with
 * why it was selected. Bounded by IN_MEMORY_PROCESSING_FETCH_CAP, same
 * tradeoff as sortRowsInMemory/executeGroupLeads. executeCountLeads and
 * executeListLeads both call this (never their own separate needsReply
 * logic), which is what guarantees they can't drift apart again.
 */
async function fetchNeedsReplyFilteredLeadRows(
  businessId: string,
  filters: LeadFilters,
  db: PrismaClientOrTransaction,
): Promise<{ rows: KoriLeadRow[]; createdAtByLeadId: Map<string, Date> }> {
  const where = buildLeadWhere(businessId, filters);
  const leads = await db.lead.findMany({ where, include: LEAD_ROW_INCLUDE, orderBy: { createdAt: "desc" }, take: IN_MEMORY_PROCESSING_FETCH_CAP });
  const createdAtByLeadId = new Map(leads.map((lead) => [lead.id, lead.createdAt]));
  const rows = leads.map(toLeadRow).filter((row) => row.needsReply === filters!.needsReply);
  return { rows, createdAtByLeadId };
}

function sortRowsByCreatedAtInMemory(rows: KoriLeadRow[], createdAtByLeadId: Map<string, Date>, direction: "asc" | "desc"): KoriLeadRow[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = createdAtByLeadId.get(a.leadId)!;
    const bv = createdAtByLeadId.get(b.leadId)!;
    return av < bv ? -factor : av > bv ? factor : 0;
  });
}

async function executeCountLeads(businessId: string, spec: KoriQuerySpec, db: PrismaClientOrTransaction): Promise<KoriQueryResult> {
  if (spec.filters?.needsReply !== undefined) {
    const { rows } = await fetchNeedsReplyFilteredLeadRows(businessId, spec.filters, db);
    return { type: "count", count: rows.length };
  }
  const count = await db.lead.count({ where: buildLeadWhere(businessId, spec.filters) });
  return { type: "count", count };
}

async function executeListLeads(businessId: string, spec: KoriQuerySpec, db: PrismaClientOrTransaction): Promise<KoriQueryResult> {
  if (spec.filters?.needsReply !== undefined) {
    const { rows: matchingRows, createdAtByLeadId } = await fetchNeedsReplyFilteredLeadRows(businessId, spec.filters, db);
    const sortedRows =
      spec.sort?.field === "createdAt"
        ? sortRowsByCreatedAtInMemory(matchingRows, createdAtByLeadId, spec.sort.direction)
        : sortRowsInMemory(matchingRows, spec.sort);
    return { type: "lead_list", count: matchingRows.length, rows: sortedRows.slice(0, spec.limit) };
  }

  const where = buildLeadWhere(businessId, spec.filters);
  const count = await db.lead.count({ where });

  if (spec.sort?.field === "createdAt") {
    const leads = await db.lead.findMany({ where, include: LEAD_ROW_INCLUDE, orderBy: { createdAt: spec.sort.direction }, take: spec.limit });
    return { type: "lead_list", count, rows: leads.map(toLeadRow) };
  }

  // lastActivityAt/nextFollowUpDueAt have no direct Lead column — fetch
  // (bounded), sort in application code, then slice to the requested limit.
  const leads = await db.lead.findMany({ where, include: LEAD_ROW_INCLUDE, take: IN_MEMORY_PROCESSING_FETCH_CAP });
  const rows = sortRowsInMemory(leads.map(toLeadRow), spec.sort);
  return { type: "lead_list", count, rows: rows.slice(0, spec.limit) };
}

async function resolveAgentNames(userIds: string[], db: PrismaClientOrTransaction): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

async function executeGroupLeads(businessId: string, spec: KoriQuerySpec, db: PrismaClientOrTransaction): Promise<KoriQueryResult> {
  // groupBy presence is already guaranteed by query-spec.ts's superRefine.
  const groupByField = spec.groupBy!;
  const where = buildLeadWhere(businessId, spec.filters);
  const leads = await db.lead.findMany({
    where,
    select: { status: true, assignedToUserId: true, commercialProfile: { select: { vehicleBrand: true, vehicleModel: true, productInterest: true, customerType: true } } },
    take: IN_MEMORY_PROCESSING_FETCH_CAP,
  });

  const counts = new Map<string, number>();
  for (const lead of leads) {
    const rawKey =
      groupByField === "leadStatus"
        ? lead.status
        : groupByField === "assignedAgent"
          ? (lead.assignedToUserId ?? "__UNASSIGNED__")
          : ((lead.commercialProfile?.[groupByField] as string | null) ?? "Unknown");
    counts.set(rawKey, (counts.get(rawKey) ?? 0) + 1);
  }

  let groups: { key: string; count: number }[];
  if (groupByField === "assignedAgent") {
    const ids = [...counts.keys()].filter((k) => k !== "__UNASSIGNED__");
    const names = await resolveAgentNames(ids, db);
    groups = [...counts.entries()].map(([key, count]) => ({ key: key === "__UNASSIGNED__" ? "Unassigned" : (names.get(key) ?? key), count }));
  } else {
    groups = [...counts.entries()].map(([key, count]) => ({ key, count }));
  }

  groups = applyGroupSort(groups, spec.sort).slice(0, spec.limit);
  return { type: "grouped_result", groups };
}

function applyGroupSort(groups: { key: string; count: number }[], sort: KoriQuerySpec["sort"]): { key: string; count: number }[] {
  if (sort && sort.field !== "count") {
    // createdAt/lastActivityAt/nextFollowUpDueAt aren't meaningful on a
    // group row — fall through to the default (count desc) rather than
    // silently doing nothing.
    return [...groups].sort((a, b) => b.count - a.count);
  }
  const factor = sort?.direction === "asc" ? 1 : -1;
  return [...groups].sort((a, b) => (a.count - b.count) * factor);
}

async function executeProductRanking(businessId: string, spec: KoriQuerySpec, db: PrismaClientOrTransaction): Promise<KoriQueryResult> {
  return executeGroupLeads(businessId, { ...spec, groupBy: "productInterest", sort: spec.sort ?? { field: "count", direction: "desc" } }, db);
}

async function executeFollowUpQueue(businessId: string, spec: KoriQuerySpec, db: PrismaClientOrTransaction): Promise<KoriQueryResult> {
  const f = spec.filters;
  const followUpWhere: Prisma.FollowUpWhereInput = {
    status: "PENDING",
    lead: { businessId, ...buildLeadFilterConditions(f, { includeOverdueFollowUpFilter: false }) },
  };
  if (f?.overdueFollowUp) {
    followUpWhere.dueAt = { lt: new Date() };
  }

  if (f?.needsReply !== undefined) {
    // Same needsReply post-filter as fetchNeedsReplyFilteredLeadRows,
    // applied to the lead each pending follow-up belongs to — the WHERE
    // clause above (via buildLeadFilterConditions) no longer expresses
    // needsReply at all, for the same reason it doesn't for Lead queries.
    const followUps = await db.followUp.findMany({
      where: followUpWhere,
      orderBy: { dueAt: "asc" },
      take: IN_MEMORY_PROCESSING_FETCH_CAP,
      include: { lead: { include: LEAD_ROW_INCLUDE } },
    });
    const matchingRows = followUps.map((fu) => toLeadRow(fu.lead)).filter((row) => row.needsReply === f.needsReply);
    return { type: "lead_list", count: matchingRows.length, rows: matchingRows.slice(0, spec.limit) };
  }

  const count = await db.followUp.count({ where: followUpWhere });
  const followUps = await db.followUp.findMany({
    where: followUpWhere,
    orderBy: { dueAt: "asc" },
    take: spec.limit,
    include: { lead: { include: LEAD_ROW_INCLUDE } },
  });

  const rows = followUps.map((fu) => toLeadRow(fu.lead));
  return { type: "lead_list", count, rows };
}

async function executeCountOutcomes(businessId: string, spec: KoriQuerySpec, db: PrismaClientOrTransaction): Promise<KoriQueryResult> {
  const f = spec.filters;
  const where: Prisma.OutcomeWhereInput = {
    decisionRecord: { businessId, conversation: { lead: buildLeadFilterConditions(f, { includeCreatedAtFilter: false }) } },
  };
  if (f?.outcomeType) where.outcomeType = f.outcomeType;
  if (f?.createdFrom || f?.createdTo) {
    where.occurredAt = {
      ...(f?.createdFrom ? { gte: new Date(f.createdFrom) } : {}),
      ...(f?.createdTo ? { lte: new Date(f.createdTo) } : {}),
    };
  }

  const count = await db.outcome.count({ where });
  return { type: "count", count };
}

export interface ExecuteKoriQueryInput {
  businessId: string;
  querySpec: unknown;
  db?: PrismaClientOrTransaction;
}

/**
 * The only entry point into this module a caller (today: tests and any
 * future application handler; later: the Groq-based NL layer) should ever
 * use. businessId always comes from the authenticated server-side caller —
 * never from querySpec, which is validated (and would reject a smuggled
 * "businessId" key) before any query is built.
 */
export async function executeKoriQuery({ businessId, querySpec, db = prisma }: ExecuteKoriQueryInput): Promise<KoriQueryResult> {
  const spec = parseKoriQuerySpec(querySpec);

  switch (spec.operation) {
    case "COUNT_LEADS":
      return executeCountLeads(businessId, spec, db);
    case "LIST_LEADS":
      return executeListLeads(businessId, spec, db);
    case "GROUP_LEADS":
      return executeGroupLeads(businessId, spec, db);
    case "COUNT_OUTCOMES":
      return executeCountOutcomes(businessId, spec, db);
    case "FOLLOW_UP_QUEUE":
      return executeFollowUpQueue(businessId, spec, db);
    case "PRODUCT_RANKING":
      return executeProductRanking(businessId, spec, db);
  }
}
