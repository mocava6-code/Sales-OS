import { prisma } from "@/server/db/client";
import type { PrismaClient } from "@/server/db/generated/client";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";
import type { AIProvider } from "@/server/intelligence/ai-provider";
import { classifyDeterministically } from "@/server/intelligence/response-action/deterministic-classifier";
import { classifyConversationActionWithAI } from "@/server/intelligence/response-action/ai-classifier";
import type { ActionClassificationResult, ActionState, ActionStateSource, ConversationActionContext } from "@/server/intelligence/response-action/types";

// --- Conversation selection (cross-conversation contamination fix) ----------
//
// A lead can have multiple conversations (manual entry, historical import,
// live WhatsApp thread — separate creation paths that don't dedupe against
// each other). Picking "whichever conversation was touched most recently,
// regardless of content" to represent the lead is wrong: confirmed in
// production, a personal/off-topic conversation receiving new messages
// silently hid a genuinely actionable WhatsApp thread behind it, because
// the newer conversation's raw timestamp won even though it had nothing to
// do with the customer's actual open request. Same root cause as
// server/intelligence/lead-commercial-state/resolve-commercial-context.ts's
// fix for commercial-field extraction — this is the action-state
// equivalent: rank by what the conversation actually needs, not by when it
// was last touched.

const ACTION_STATE_URGENCY: Record<ActionState, number> = {
  REPLY_REQUIRED: 0,
  UNCERTAIN: 1,
  FOLLOW_UP_REQUIRED: 2,
  WAITING_ON_CUSTOMER: 3,
  NO_ACTION_REQUIRED: 4,
};

export interface RankableConversation {
  status: "NEEDS_REPLY" | "WAITING_ON_CUSTOMER" | "CLOSED";
  lastEntryAt: Date;
}

/**
 * Picks which of a lead's conversations should represent it for
 * actionState purposes. Prefers non-CLOSED conversations; among those, the
 * most urgent resolved actionState wins (REPLY_REQUIRED first,
 * NO_ACTION_REQUIRED last — UNCERTAIN ranks second, deliberately above
 * FOLLOW_UP_REQUIRED/WAITING_ON_CUSTOMER, since an uncertain conversation
 * needs human review and must never be silently outranked by an
 * already-handled one); ties broken by recency.
 */
export function selectMostActionableConversation<C extends RankableConversation>(
  conversations: C[],
  resolveState: (conversation: C) => ActionState,
): C | null {
  if (conversations.length === 0) return null;
  const nonClosed = conversations.filter((c) => c.status !== "CLOSED");
  const pool = nonClosed.length > 0 ? nonClosed : conversations;

  return pool
    .slice()
    .sort((a, b) => {
      const urgencyDelta = ACTION_STATE_URGENCY[resolveState(a)] - ACTION_STATE_URGENCY[resolveState(b)];
      if (urgencyDelta !== 0) return urgencyDelta;
      return b.lastEntryAt.getTime() - a.lastEntryAt.getTime();
    })[0];
}

const STATUS_URGENCY: Record<RankableConversation["status"], number> = {
  NEEDS_REPLY: 0,
  WAITING_ON_CUSTOMER: 1,
  CLOSED: 2,
};

/**
 * A cheaper variant for read paths that don't fetch entries/actionState
 * (e.g. Kori queries with no actionState/needsReply filter) — ranks by the
 * conversation's own status only (NEEDS_REPLY beats WAITING_ON_CUSTOMER
 * beats CLOSED), tie-broken by recency. Still fixes the same contamination:
 * a lead's `needsReply` boolean must reflect its own open conversation
 * needing a reply, never get masked by a newer but already-closed or
 * waiting-on-customer one.
 */
export function selectMostRelevantConversationByStatus<C extends RankableConversation>(conversations: C[]): C | null {
  if (conversations.length === 0) return null;
  return conversations
    .slice()
    .sort((a, b) => {
      const delta = STATUS_URGENCY[a.status] - STATUS_URGENCY[b.status];
      if (delta !== 0) return delta;
      return b.lastEntryAt.getTime() - a.lastEntryAt.getTime();
    })[0];
}

// Kori Semantic Response Intelligence v0 — the ONE place Today, Kori, and
// any future analytics consumer must go through to learn "does this
// conversation actually need an advisor action." Never re-derive this from
// Conversation.status/lastEntryDirection independently — see
// server/intelligence/response-action/types.ts's module doc comment for
// why that's exactly the flaw this system exists to fix.

/** Bounded — "prefer a bounded recent context window... rather than repeatedly sending entire long conversation histories." */
const RECENT_ENTRIES_WINDOW = 15;

const RESOLVER_ENGINE_VERSION = "response-action-service.1.0.0";

// --- Fetch + transform ------------------------------------------------------

interface RawConversationForActionContext {
  id: string;
  leadId: string;
  status: "NEEDS_REPLY" | "WAITING_ON_CUSTOMER" | "CLOSED";
  lastEntryAt: Date;
  lastEntryDirection: "INBOUND" | "OUTBOUND";
  entries: { id: string; direction: "INBOUND" | "OUTBOUND"; content: string; occurredAt: Date }[];
  lead: {
    commercialProfile: { nextAction: ConversationActionContext["structural"]["leadNextAction"] } | null;
    followUps: { status: "PENDING" | "DONE" | "SNOOZED"; dueAt: Date }[];
  };
}

export function toConversationActionContext(raw: RawConversationForActionContext): ConversationActionContext {
  const now = new Date();
  const pendingFollowUps = raw.lead.followUps.filter((f) => f.status === "PENDING");
  return {
    conversationId: raw.id,
    leadId: raw.leadId,
    observedStatus: raw.status,
    lastEntryDirection: raw.lastEntryDirection,
    lastEntryAt: raw.lastEntryAt,
    recentEntries: raw.entries,
    structural: {
      leadNextAction: raw.lead.commercialProfile?.nextAction ?? null,
      hasOverdueFollowUp: pendingFollowUps.some((f) => f.dueAt.getTime() < now.getTime()),
      hasPendingFollowUp: pendingFollowUps.length > 0,
    },
  };
}

export async function fetchConversationForActionContext(businessId: string, conversationId: string, db: PrismaClientOrTransaction = prisma): Promise<ConversationActionContext | null> {
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, businessId },
    select: {
      id: true,
      leadId: true,
      status: true,
      lastEntryAt: true,
      lastEntryDirection: true,
      entries: { orderBy: { occurredAt: "desc" }, take: RECENT_ENTRIES_WINDOW, select: { id: true, direction: true, content: true, occurredAt: true } },
      lead: {
        select: {
          commercialProfile: { select: { nextAction: true } },
          followUps: { select: { status: true, dueAt: true } },
        },
      },
    },
  });
  if (!conversation) return null;

  // entries were fetched newest-first (for a cheap bounded LIMIT); the
  // classifier reads oldest -> newest, same convention as every other
  // "recent window" in this codebase (server/lead-commercial-state/...).
  const raw: RawConversationForActionContext = { ...conversation, entries: [...conversation.entries].reverse() };
  return toConversationActionContext(raw);
}

// --- Classification (no write) ----------------------------------------------

export interface ClassifyConversationActionDependencies {
  /** Omit to skip the AI layer entirely — deterministic-inconclusive cases resolve to UNCERTAIN instead of calling out. */
  aiProvider?: AIProvider;
}

/**
 * Deterministic first; AI only when deterministic is inconclusive AND an
 * aiProvider was supplied. Never lets an AI failure/timeout/unavailability
 * propagate as anything other than UNCERTAIN — the safety principle this
 * whole system is built around.
 */
export async function classifyConversationAction(context: ConversationActionContext, deps: ClassifyConversationActionDependencies = {}): Promise<ActionClassificationResult> {
  const deterministic = classifyDeterministically(context);
  if (deterministic.resolved && deterministic.result) {
    return deterministic.result;
  }

  if (!deps.aiProvider) {
    return uncertainFallback("Deterministic rules were inconclusive and no AI provider was supplied for this call.");
  }

  try {
    return await classifyConversationActionWithAI(context, { aiProvider: deps.aiProvider });
  } catch (error) {
    return uncertainFallback(`Deterministic rules were inconclusive and AI classification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function uncertainFallback(reasoning: string): ActionClassificationResult {
  return { actionState: "UNCERTAIN", reasonCode: "UNCERTAIN_CONTEXT", confidence: 0, reasoning, evidenceEntryIds: [], recommendedAction: null, source: "DETERMINISTIC" };
}

// --- Persistence -------------------------------------------------------------

export interface ProjectConversationActionStateResult {
  created: boolean;
  updated: boolean;
  skippedReason: "NO_CHANGE" | "HUMAN_OVERRIDE_FRESH" | "CONVERSATION_NOT_FOUND" | null;
}

/**
 * Computes and stores the classification. Race-safe (upsert, same pattern
 * as projectLeadCommercialProfile) — but ALSO never overwrites a fresh
 * human override: a deliberate advisor decision stays authoritative until
 * a NEW conversation entry arrives after it was set, exactly like the read
 * path (resolveOperationalActionState) enforces, so a batch/background
 * recompute can never silently fight an advisor who already made the call.
 */
export async function projectConversationActionState(
  businessId: string,
  conversationId: string,
  db: PrismaClient = prisma,
  deps: ClassifyConversationActionDependencies = {},
): Promise<ProjectConversationActionStateResult> {
  return db.$transaction(async (tx) => {
    const conversation = await tx.conversation.findFirst({ where: { id: conversationId, businessId }, select: { lastEntryAt: true, entries: { select: { id: true } } } });
    if (!conversation) return { created: false, updated: false, skippedReason: "CONVERSATION_NOT_FOUND" };

    const existing = await tx.conversationActionState.findUnique({ where: { conversationId } });
    if (existing?.humanOverride && existing.basedOnLastEntryAt.getTime() >= conversation.lastEntryAt.getTime()) {
      return { created: false, updated: false, skippedReason: "HUMAN_OVERRIDE_FRESH" };
    }

    const context = await fetchConversationForActionContext(businessId, conversationId, tx);
    if (!context) return { created: false, updated: false, skippedReason: "CONVERSATION_NOT_FOUND" };

    const classification = await classifyConversationAction(context, deps);

    if (
      existing &&
      existing.actionState === classification.actionState &&
      existing.reasonCode === classification.reasonCode &&
      existing.basedOnLastEntryAt.getTime() === conversation.lastEntryAt.getTime()
    ) {
      return { created: false, updated: false, skippedReason: "NO_CHANGE" };
    }

    const computedAt = new Date();
    await tx.conversationActionState.upsert({
      where: { conversationId },
      create: {
        conversationId,
        businessId,
        actionState: classification.actionState,
        reasonCode: classification.reasonCode,
        confidence: classification.confidence,
        reasoning: classification.reasoning,
        evidenceEntryIds: classification.evidenceEntryIds,
        recommendedAction: classification.recommendedAction,
        source: classification.source,
        computedAt,
        engineVersion: RESOLVER_ENGINE_VERSION,
        basedOnLastEntryAt: conversation.lastEntryAt,
        basedOnEntryCount: conversation.entries.length,
      },
      update: {
        actionState: classification.actionState,
        reasonCode: classification.reasonCode,
        confidence: classification.confidence,
        reasoning: classification.reasoning,
        evidenceEntryIds: classification.evidenceEntryIds,
        recommendedAction: classification.recommendedAction,
        source: classification.source,
        computedAt,
        engineVersion: RESOLVER_ENGINE_VERSION,
        basedOnLastEntryAt: conversation.lastEntryAt,
        basedOnEntryCount: conversation.entries.length,
        // A fresh (non-stale) automatic recompute never touches a human's
        // own fields — only the branch above (stale human override) can
        // reach this update with humanOverride still true, and in that
        // case the new automatic result correctly supersedes it.
        humanOverride: false,
        humanSetByUserId: null,
        humanSetAt: null,
      },
    });

    return { created: !existing, updated: existing !== null, skippedReason: null };
  });
}

export type SetHumanConversationActionStateReasonCode = "MARKED_NO_ACTION_REQUIRED" | "MARKED_FOLLOW_UP_REQUIRED" | "MARKED_ALREADY_ANSWERED";

/**
 * "No requiere respuesta" / "Necesita seguimiento" / "Ya respondido" — the
 * advisor override this whole system is designed to defer to.
 * resolveOperationalActionState treats this as authoritative until a NEW
 * conversation entry arrives after `humanSetAt`, so the classifier never
 * repeatedly re-flags a conversation an advisor already handled.
 */
export async function setHumanConversationActionState(
  businessId: string,
  conversationId: string,
  actionState: ActionState,
  reasonCode: SetHumanConversationActionStateReasonCode,
  userId: string,
  db: PrismaClient = prisma,
): Promise<void> {
  const conversation = await db.conversation.findFirst({ where: { id: conversationId, businessId }, select: { lastEntryAt: true, entries: { select: { id: true } } } });
  if (!conversation) throw new Error("Conversation not found.");

  const now = new Date();
  await db.conversationActionState.upsert({
    where: { conversationId },
    create: {
      conversationId,
      businessId,
      actionState,
      reasonCode,
      confidence: 1,
      reasoning: "Set by an advisor.",
      evidenceEntryIds: [],
      recommendedAction: null,
      source: "HUMAN",
      computedAt: now,
      engineVersion: RESOLVER_ENGINE_VERSION,
      basedOnLastEntryAt: conversation.lastEntryAt,
      basedOnEntryCount: conversation.entries.length,
      humanOverride: true,
      humanSetByUserId: userId,
      humanSetAt: now,
    },
    update: {
      actionState,
      reasonCode,
      confidence: 1,
      reasoning: "Set by an advisor.",
      evidenceEntryIds: [],
      recommendedAction: null,
      source: "HUMAN",
      computedAt: now,
      engineVersion: RESOLVER_ENGINE_VERSION,
      basedOnLastEntryAt: conversation.lastEntryAt,
      basedOnEntryCount: conversation.entries.length,
      humanOverride: true,
      humanSetByUserId: userId,
      humanSetAt: now,
    },
  });
}

// --- Canonical read model ----------------------------------------------------

export interface StoredActionStateForResolution {
  actionState: ActionState;
  reasonCode: string;
  confidence: number;
  reasoning: string;
  evidenceEntryIds: string[];
  recommendedAction: string | null;
  source: ActionStateSource;
  humanOverride: boolean;
  basedOnLastEntryAt: Date;
}

/**
 * THE canonical resolver — every consumer (Today, Kori, analytics) must
 * call this, never re-derive the operational state independently.
 * Precedence: a fresh human override always wins; otherwise a fresh stored
 * (deterministic or AI) result; otherwise a cheap LIVE deterministic-only
 * recompute (never AI — AI never runs on a synchronous query path); if
 * even that is inconclusive, UNCERTAIN. "Fresh" means computed against the
 * conversation's current lastEntryAt — a new message since then makes any
 * stored state (including a human one) stale.
 */
export function resolveOperationalActionState(conversationLastEntryAt: Date, stored: StoredActionStateForResolution | null, liveContext: ConversationActionContext): ActionClassificationResult {
  if (stored) {
    const isFresh = stored.basedOnLastEntryAt.getTime() >= conversationLastEntryAt.getTime();
    if (isFresh) {
      return {
        actionState: stored.actionState,
        reasonCode: stored.reasonCode,
        confidence: stored.confidence,
        reasoning: stored.reasoning,
        evidenceEntryIds: stored.evidenceEntryIds,
        recommendedAction: stored.recommendedAction,
        source: stored.source,
      };
    }
  }

  const live = classifyDeterministically(liveContext);
  if (live.resolved && live.result) return live.result;

  return uncertainFallback("No fresh stored classification, and live deterministic rules were inconclusive.");
}

// --- Today grouping ----------------------------------------------------------

export interface TodayActionGroupEntry {
  leadId: string;
  conversationId: string | null;
  actionState: ActionState;
  reasonCode: string;
}

export interface TodayActionGroups {
  replyRequired: TodayActionGroupEntry[];
  followUpRequired: TodayActionGroupEntry[];
  waitingOnCustomer: TodayActionGroupEntry[];
  noActionRequired: TodayActionGroupEntry[];
  uncertain: TodayActionGroupEntry[];
}

function emptyTodayActionGroups(): TodayActionGroups {
  return { replyRequired: [], followUpRequired: [], waitingOnCustomer: [], noActionRequired: [], uncertain: [] };
}

function bucketFor(groups: TodayActionGroups, actionState: ActionState): TodayActionGroupEntry[] {
  switch (actionState) {
    case "REPLY_REQUIRED":
      return groups.replyRequired;
    case "FOLLOW_UP_REQUIRED":
      return groups.followUpRequired;
    case "WAITING_ON_CUSTOMER":
      return groups.waitingOnCustomer;
    case "NO_ACTION_REQUIRED":
      return groups.noActionRequired;
    case "UNCERTAIN":
      return groups.uncertain;
  }
}

/**
 * "Today should eventually separate: Responder ahora / Seguimiento /
 * Esperando al cliente / Revisar / Sin acción." This is that grouping,
 * built on the exact same canonical resolver Kori's actionState filter
 * uses (server/kori/query-executor.ts's fetchActionAwareLeadRows) — never
 * a second, independently-defined notion of "needs action." A lead with no
 * conversation at all is bucketed as `uncertain` (never silently dropped).
 */
/** A lead very rarely has more than a handful of conversations at pilot scale — bounded defensively, not a correctness cap. */
const MAX_CONVERSATIONS_PER_LEAD_FOR_ACTION_STATE = 20;

export async function groupLeadsByOperationalActionState(businessId: string, db: PrismaClientOrTransaction = prisma): Promise<TodayActionGroups> {
  const leads = await db.lead.findMany({
    where: { businessId },
    select: {
      id: true,
      commercialProfile: { select: { nextAction: true } },
      followUps: { select: { status: true, dueAt: true } },
      conversations: {
        orderBy: { lastEntryAt: "desc" },
        take: MAX_CONVERSATIONS_PER_LEAD_FOR_ACTION_STATE,
        include: {
          entries: { orderBy: { occurredAt: "desc" }, take: RECENT_ENTRIES_WINDOW },
          actionState: true,
        },
      },
    },
  });

  const groups = emptyTodayActionGroups();

  for (const lead of leads) {
    if (lead.conversations.length === 0) {
      groups.uncertain.push({ leadId: lead.id, conversationId: null, actionState: "UNCERTAIN", reasonCode: "UNCERTAIN_CONTEXT" });
      continue;
    }

    // Resolve every one of the lead's conversations, then surface whichever
    // is most actionable — never just the one touched most recently,
    // regardless of content (see selectMostActionableConversation's doc
    // comment for the production case this fixes).
    const resolvedByConversationId = new Map<string, ActionClassificationResult>();
    for (const conversation of lead.conversations) {
      const context = toConversationActionContext({
        id: conversation.id,
        leadId: lead.id,
        status: conversation.status,
        lastEntryAt: conversation.lastEntryAt,
        lastEntryDirection: conversation.lastEntryDirection,
        entries: [...conversation.entries].reverse(),
        lead: { commercialProfile: lead.commercialProfile, followUps: lead.followUps },
      });

      const stored: StoredActionStateForResolution | null = conversation.actionState
        ? {
            actionState: conversation.actionState.actionState,
            reasonCode: conversation.actionState.reasonCode,
            confidence: conversation.actionState.confidence,
            reasoning: conversation.actionState.reasoning,
            evidenceEntryIds: conversation.actionState.evidenceEntryIds,
            recommendedAction: conversation.actionState.recommendedAction,
            source: conversation.actionState.source,
            humanOverride: conversation.actionState.humanOverride,
            basedOnLastEntryAt: conversation.actionState.basedOnLastEntryAt,
          }
        : null;

      resolvedByConversationId.set(conversation.id, resolveOperationalActionState(conversation.lastEntryAt, stored, context));
    }

    const mostActionable = selectMostActionableConversation(lead.conversations, (c) => resolvedByConversationId.get(c.id)!.actionState);
    const resolved = resolvedByConversationId.get(mostActionable!.id)!;
    bucketFor(groups, resolved.actionState).push({ leadId: lead.id, conversationId: mostActionable!.id, actionState: resolved.actionState, reasonCode: resolved.reasonCode });
  }

  return groups;
}
