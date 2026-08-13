import { prisma } from "@/server/db/client";
import type { PrismaClient } from "@/server/db/generated/client";
import type { AIProvider } from "@/server/intelligence/ai-provider";
import type { ActionState, ActionStateSource } from "@/server/intelligence/response-action/types";
import {
  classifyConversationAction,
  fetchConversationForActionContext,
  isRateLimitedError,
  projectConversationActionState,
  resolveOperationalActionState,
  toConversationActionContext,
  type StoredActionStateForResolution,
} from "./conversation-action-state-service";

// Phase 4 (production AI execution path) — the ONE place an authenticated,
// OWNER-only maintenance action reaches for AI-assisted response-action
// classification. Two modes, both idempotent and resumable:
//   - persist=false ("evaluate"): classifies a batch of currently-UNCERTAIN
//     conversations and returns the results WITHOUT writing anything —
//     used by Phase 5's evaluation against real production UNCERTAIN
//     cases, before any backfill is trusted.
//   - persist=true ("backfill"): calls projectConversationActionState
//     (already idempotent/race-safe) for each conversation in the batch —
//     used by Phase 6's actual backfill, after evaluation passes.
//
// businessId is always the caller's own parameter (the application layer
// resolves it from the authenticated OWNER, never from user input — see
// server/application/response-action-actions.ts). batchSize is bounded.
// Concurrency is deliberately sequential (concurrency of 1): Groq's
// free-tier rate limit is a low TPM cap (confirmed by the existing
// app/api/internal/kori-groq-smoke-test/route.ts comment — 6 sequential
// calls in one request already exceeded it), so running several
// classifications in parallel would make hitting 429 more likely, not
// less. On a rate-limit error the batch stops immediately (never retries
// in a loop) and reports how many conversations were left unprocessed —
// safe to resume by calling again later, since only conversations still
// resolving to UNCERTAIN are ever re-selected.
//
// Returns only structured fields (actionState/reasonCode/confidence/
// source) — never `reasoning` text or message content, so a raw customer
// message never leaves this function through the maintenance-tool
// response, satisfying "no raw customer message dumps returned."

const MAX_BATCH_SIZE = 25;
const MAX_CANDIDATE_SCAN = 200;

export interface ResponseActionAIBatchOptions {
  businessId: string;
  batchSize: number;
  persist: boolean;
  aiProvider: AIProvider | undefined;
}

export interface ResponseActionAIBatchItemResult {
  conversationId: string;
  leadId: string;
  before: ActionState;
  after: ActionState;
  reasonCode: string;
  source: ActionStateSource;
  confidence: number;
  persisted: boolean;
}

export interface ResponseActionAIBatchResult {
  aiProviderConfigured: boolean;
  aiProviderName: string | null;
  scanned: number;
  processed: number;
  skippedRateLimited: number;
  skippedOtherError: number;
  distribution: Partial<Record<ActionState, number>>;
  items: ResponseActionAIBatchItemResult[];
  failures: Array<{ conversationId: string; message: string }>;
}

interface CandidateConversation {
  id: string;
  leadId: string;
  status: "NEEDS_REPLY" | "WAITING_ON_CUSTOMER" | "CLOSED";
  lastEntryAt: Date;
  lastEntryDirection: "INBOUND" | "OUTBOUND";
}

/** A conversation whose CURRENT (deterministic-only, live) resolution is UNCERTAIN — the only pool this batch job ever touches. */
async function findUncertainConversations(businessId: string, limit: number, db: PrismaClient): Promise<CandidateConversation[]> {
  const conversations = await db.conversation.findMany({
    where: { businessId, status: { not: "CLOSED" } },
    orderBy: { lastEntryAt: "desc" },
    take: MAX_CANDIDATE_SCAN,
    select: {
      id: true,
      leadId: true,
      status: true,
      lastEntryAt: true,
      lastEntryDirection: true,
      actionState: true,
      lead: { select: { commercialProfile: { select: { nextAction: true } }, followUps: { select: { status: true, dueAt: true } } } },
      entries: { orderBy: { occurredAt: "desc" }, take: 15, select: { id: true, direction: true, content: true, occurredAt: true } },
    },
  });

  const uncertain: CandidateConversation[] = [];
  for (const conversation of conversations) {
    if (uncertain.length >= limit) break;

    const context = toConversationActionContext({
      id: conversation.id,
      leadId: conversation.leadId,
      status: conversation.status,
      lastEntryAt: conversation.lastEntryAt,
      lastEntryDirection: conversation.lastEntryDirection,
      entries: [...conversation.entries].reverse(),
      lead: {
        commercialProfile: conversation.lead.commercialProfile ? { nextAction: conversation.lead.commercialProfile.nextAction } : null,
        followUps: conversation.lead.followUps,
      },
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

    const resolved = resolveOperationalActionState(conversation.lastEntryAt, stored, context);
    if (resolved.actionState === "UNCERTAIN") {
      uncertain.push({ id: conversation.id, leadId: conversation.leadId, status: conversation.status, lastEntryAt: conversation.lastEntryAt, lastEntryDirection: conversation.lastEntryDirection });
    }
  }

  return uncertain;
}

export async function runResponseActionAIBatch(options: ResponseActionAIBatchOptions, db: PrismaClient = prisma): Promise<ResponseActionAIBatchResult> {
  const batchSize = Math.min(Math.max(1, options.batchSize), MAX_BATCH_SIZE);

  const result: ResponseActionAIBatchResult = {
    aiProviderConfigured: options.aiProvider !== undefined,
    aiProviderName: options.aiProvider?.name ?? null,
    scanned: 0,
    processed: 0,
    skippedRateLimited: 0,
    skippedOtherError: 0,
    distribution: {},
    items: [],
    failures: [],
  };

  if (!options.aiProvider) {
    return result;
  }

  const candidates = await findUncertainConversations(options.businessId, batchSize, db);
  result.scanned = candidates.length;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];

    try {
      if (options.persist) {
        await projectConversationActionState(options.businessId, candidate.id, db, { aiProvider: options.aiProvider, rethrowRateLimitErrors: true });
        const row = await db.conversationActionState.findUnique({ where: { conversationId: candidate.id } });
        if (!row) throw new Error("projectConversationActionState did not create a row.");

        result.items.push({
          conversationId: candidate.id,
          leadId: candidate.leadId,
          before: "UNCERTAIN",
          after: row.actionState,
          reasonCode: row.reasonCode,
          source: row.source,
          confidence: row.confidence,
          persisted: true,
        });
        result.distribution[row.actionState] = (result.distribution[row.actionState] ?? 0) + 1;
      } else {
        const context = await fetchConversationForActionContext(options.businessId, candidate.id, db);
        if (!context) throw new Error("Conversation not found during classification.");

        const classification = await classifyConversationAction(context, { aiProvider: options.aiProvider, rethrowRateLimitErrors: true });

        result.items.push({
          conversationId: candidate.id,
          leadId: candidate.leadId,
          before: "UNCERTAIN",
          after: classification.actionState,
          reasonCode: classification.reasonCode,
          source: classification.source,
          confidence: classification.confidence,
          persisted: false,
        });
        result.distribution[classification.actionState] = (result.distribution[classification.actionState] ?? 0) + 1;
      }

      result.processed++;
    } catch (error) {
      if (isRateLimitedError(error)) {
        result.skippedRateLimited = candidates.length - i;
        break;
      }

      result.skippedOtherError++;
      result.failures.push({ conversationId: candidate.id, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return result;
}
