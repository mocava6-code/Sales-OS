import { z } from "zod";
import { InvalidKoriQuerySpecError } from "./errors";

// Kori Natural Language Analytics v0 — the deterministic query contract a
// future NL layer (Groq) will target. Never accepts businessId — that only
// ever comes from the authenticated server-side caller of executeKoriQuery
// (server/kori/query-executor.ts), never from this spec. `.strict()`
// schemas below reject any unknown key (including a smuggled businessId)
// at the validation boundary, not just via the TS type.

export const KORI_QUERY_OPERATIONS = [
  "COUNT_LEADS",
  "LIST_LEADS",
  "GROUP_LEADS",
  "COUNT_OUTCOMES",
  "FOLLOW_UP_QUEUE",
  "PRODUCT_RANKING",
] as const;
export type KoriQueryOperation = (typeof KORI_QUERY_OPERATIONS)[number];

export const KORI_GROUP_BY_FIELDS = [
  "vehicleBrand",
  "vehicleModel",
  "productInterest",
  "customerType",
  "leadStatus",
  "assignedAgent",
] as const;
export type KoriGroupByField = (typeof KORI_GROUP_BY_FIELDS)[number];

export const KORI_SORT_FIELDS = ["createdAt", "lastActivityAt", "nextFollowUpDueAt", "count"] as const;
export type KoriSortField = (typeof KORI_SORT_FIELDS)[number];

// Mirrors server/db/schema.prisma's LeadStatus/LeadPriority/OutcomeType
// enum values verbatim — Prisma's generated enums aren't directly
// zod-compatible, so these are redeclared here (same pattern already used
// elsewhere in this codebase, e.g. lib/validations/whatsapp.ts's
// historicalImportDateOrderSchema mirroring ImportDateOrder).
// Exported (not just module-local) so the Kori NL parser's Groq-facing
// schema/prompt (server/kori/nl-query-parser.ts) can build its enum lists
// from these directly, instead of redeclaring them and risking drift.
export const LEAD_STATUS_VALUES = ["NEW", "CONTACTED", "FOLLOW_UP", "WON", "LOST"] as const;
export const LEAD_PRIORITY_VALUES = ["NORMAL", "HIGH"] as const;
export const OUTCOME_TYPE_VALUES = [
  "CUSTOMER_REPLIED",
  "MEETING_SCHEDULED",
  "FOLLOW_UP_SENT",
  "QUOTATION_REQUESTED",
  "QUOTATION_SENT",
  "SALE_CLOSED",
  "SALE_LOST",
  "ABANDONED",
] as const;
// UNKNOWN deliberately excluded from the filter — see plan §E. A lead's
// actual stored customerType can still be UNKNOWN; you just can't filter
// FOR it this phase.
export const CUSTOMER_TYPE_FILTER_VALUES = ["RETAIL", "WHOLESALE"] as const;

// Kori Semantic Response Intelligence v0 — mirrors server/db/schema.prisma's
// ConversationActionStateValue verbatim. Deliberately a DIFFERENT question
// than `needsReply`: needsReply is "which side sent the last message"
// (Conversation.status, a transport fact); actionState is "does an advisor
// genuinely need to do something" (server/services/
// conversation-action-state-service.ts's canonical resolver). A question
// like "¿quién necesita seguimiento aunque el último mensaje diga gracias?"
// maps to actionState=FOLLOW_UP_REQUIRED, not needsReply=true.
export const ACTION_STATE_FILTER_VALUES = ["REPLY_REQUIRED", "FOLLOW_UP_REQUIRED", "WAITING_ON_CUSTOMER", "NO_ACTION_REQUIRED", "UNCERTAIN"] as const;

export const KORI_QUERY_DEFAULT_LIMIT = 25;
export const KORI_QUERY_MAX_LIMIT = 100;

const isoDateString = z.string().refine((value) => !Number.isNaN(Date.parse(value)), { error: "Must be a valid ISO date string." });

const koriQueryFiltersSchema = z
  .object({
    vehicleBrand: z.string().trim().min(1).optional(),
    vehicleModel: z.string().trim().min(1).optional(),
    vehicleYear: z.number().int().min(1900).max(2100).optional(),
    productInterest: z.string().trim().min(1).optional(),
    customerType: z.enum(CUSTOMER_TYPE_FILTER_VALUES).optional(),
    needsReply: z.boolean().optional(),
    actionState: z.enum(ACTION_STATE_FILTER_VALUES).optional(),
    overdueFollowUp: z.boolean().optional(),
    leadStatus: z.enum(LEAD_STATUS_VALUES).optional(),
    priority: z.enum(LEAD_PRIORITY_VALUES).optional(),
    assignedAgentId: z.string().trim().min(1).optional(),
    createdFrom: isoDateString.optional(),
    createdTo: isoDateString.optional(),
    lastActivityBefore: isoDateString.optional(),
    lastActivityAfter: isoDateString.optional(),
    outcomeType: z.enum(OUTCOME_TYPE_VALUES).optional(),
  })
  .strict();

const koriQuerySortSchema = z
  .object({
    field: z.enum(KORI_SORT_FIELDS),
    direction: z.enum(["asc", "desc"]),
  })
  .strict();

const koriQuerySpecSchema = z
  .object({
    operation: z.enum(KORI_QUERY_OPERATIONS),
    filters: koriQueryFiltersSchema.optional(),
    groupBy: z.enum(KORI_GROUP_BY_FIELDS).optional(),
    sort: koriQuerySortSchema.optional(),
    limit: z.number().int().min(1).max(KORI_QUERY_MAX_LIMIT).optional(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    if (spec.operation === "GROUP_LEADS" && !spec.groupBy) {
      ctx.addIssue({ code: "custom", path: ["groupBy"], message: "groupBy is required for GROUP_LEADS." });
    }
    if (spec.operation !== "GROUP_LEADS" && spec.groupBy) {
      ctx.addIssue({ code: "custom", path: ["groupBy"], message: `groupBy is not valid for ${spec.operation}.` });
    }

    const f = spec.filters;
    if (f?.createdFrom && f?.createdTo && Date.parse(f.createdFrom) > Date.parse(f.createdTo)) {
      ctx.addIssue({ code: "custom", path: ["filters", "createdFrom"], message: "createdFrom must be before or equal to createdTo." });
    }
    if (f?.lastActivityAfter && f?.lastActivityBefore && Date.parse(f.lastActivityAfter) > Date.parse(f.lastActivityBefore)) {
      ctx.addIssue({
        code: "custom",
        path: ["filters", "lastActivityAfter"],
        message: "lastActivityAfter must be before or equal to lastActivityBefore.",
      });
    }
  });

type KoriQuerySpecInput = z.infer<typeof koriQuerySpecSchema>;

/** The resolved spec executeKoriQuery actually consumes — `limit` is always a concrete number (defaulted), never left for the executor to interpret. */
export interface KoriQuerySpec extends Omit<KoriQuerySpecInput, "limit"> {
  limit: number;
}

/** Throws InvalidKoriQuerySpecError (never returns a partially-valid spec) — the executor never has to re-validate. */
export function parseKoriQuerySpec(raw: unknown): KoriQuerySpec {
  const parsed = koriQuerySpecSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidKoriQuerySpecError("Invalid KoriQuerySpec.", parsed.error.issues);
  }
  return { ...parsed.data, limit: parsed.data.limit ?? KORI_QUERY_DEFAULT_LIMIT };
}

// --- Results -----------------------------------------------------------------

export interface KoriLeadRow {
  leadId: string;
  name: string;
  phone: string;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  productInterest: string | null;
  customerType: "RETAIL" | "WHOLESALE" | "UNKNOWN" | null;
  needsReply: boolean;
  /** Semantic Response Intelligence v0's canonical operational state — see server/services/conversation-action-state-service.ts's resolveOperationalActionState. Distinct from needsReply (see ACTION_STATE_FILTER_VALUES's doc comment). */
  actionState: (typeof ACTION_STATE_FILTER_VALUES)[number];
  nextFollowUpDueAt: string | null;
  lastActivityAt: string | null;
}

export type KoriQueryResult =
  | { type: "lead_list"; count: number; rows: KoriLeadRow[] }
  | { type: "grouped_result"; groups: { key: string; count: number }[] }
  | { type: "count"; count: number };
