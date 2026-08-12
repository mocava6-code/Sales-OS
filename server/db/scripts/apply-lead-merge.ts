import type { PrismaClient } from "../generated/client";
import { planLeadMerge, type MergePlan } from "./merge-remediation-plan";
import { commercialProfileCollisionIsResolved, type ApprovedMergeResolution } from "./merge-resolution";

// Kori Legacy Data Remediation v0 — Merge Executor v0, THE REAL WRITE PATH.
//
// The only function in this codebase capable of actually merging two Lead
// rows. Everything upstream of this file (auditDuplicateLeadPhones,
// planLeadMerge, executeLeadMerge) is read-only by construction — this one
// is not. It opens exactly one Prisma interactive transaction, re-reads and
// re-validates BOTH leads from inside that transaction (never trusts
// `approvedPlan` as anything more than the human-reviewed baseline to diff
// live state against), and rolls back entirely — Prisma's default behavior
// when the transaction callback throws — the instant any invariant fails.
// There is no partial-merge outcome: either every write below happened, or
// none of them did.
//
// Deliberately still no generalized "merge all duplicates" command — this
// operates on exactly the one (businessId, survivorLeadId, loserLeadId)
// triple passed in, once per call, and every blocker planLeadMerge would
// report still applies except the one narrow, explicit override described
// in merge-resolution.ts.

export class MergeAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeAbortedError";
  }
}

export interface AppliedLeadMergeResult {
  applied: true;
  survivorLeadId: string;
  loserLeadId: string;
  canonicalPhone: string;
  reparentedConversationIds: string[];
  reparentedFollowUpIds: string[];
  commercialProfileAction: "KEEP_SURVIVOR" | "MOVE_LOSER_TO_SURVIVOR" | "NO_PROFILE" | "RESOLVED_COLLISION_KEEP_SURVIVOR";
  finalSurvivorConversationCount: number;
  finalSurvivorFollowUpCount: number;
}

export interface RefusedLeadMergeResult {
  applied: false;
  reason: string;
}

export type ApplyLeadMergeResult = AppliedLeadMergeResult | RefusedLeadMergeResult;

function cardinalityBeforeMatches(a: MergePlan["cardinality"], b: MergePlan["cardinality"]): boolean {
  if (!a || !b) return false;
  return (
    a.before.survivorConversationCount === b.before.survivorConversationCount &&
    a.before.loserConversationCount === b.before.loserConversationCount &&
    a.before.survivorFollowUpCount === b.before.survivorFollowUpCount &&
    a.before.loserFollowUpCount === b.before.loserFollowUpCount &&
    a.before.survivorOutcomeCount === b.before.survivorOutcomeCount &&
    a.before.loserOutcomeCount === b.before.loserOutcomeCount
  );
}

function sameIds(a: string[], b: string[]): boolean {
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.length === sortedB.length && sortedA.every((id, i) => id === sortedB[i]);
}

/**
 * Applies a human-approved lead merge. Requires `approvedPlan` — the same
 * requirement executeLeadMerge already established — as the baseline
 * "nothing has drifted since a human reviewed this" is diffed against; a
 * bare-ids signature can't answer that question. A COMMERCIAL_PROFILE_
 * COLLISION still refuses unless `resolution` explicitly and exactly
 * covers this exact (businessId, survivorLeadId, loserLeadId) triple with
 * `resolution: "KEEP_SURVIVOR"` — every other duplicate pair's collision,
 * and every OTHER blocker on this pair (cross-business, phone mismatch,
 * missing lead, assignment mismatch), still refuses unconditionally; there
 * is no override for those in v0.
 */
export async function applyLeadMerge(
  db: PrismaClient,
  input: { businessId: string; survivorLeadId: string; loserLeadId: string; approvedPlan: MergePlan; resolution?: ApprovedMergeResolution },
): Promise<ApplyLeadMergeResult> {
  try {
    return await db.$transaction(async (tx) => {
      // 1. Re-read and re-validate — entirely inside the transaction.
      const freshPlan = await planLeadMerge(tx, { businessId: input.businessId, survivorLeadId: input.survivorLeadId, loserLeadId: input.loserLeadId });

      if (freshPlan.businessId !== input.approvedPlan.businessId || freshPlan.survivorLeadId !== input.approvedPlan.survivorLeadId || freshPlan.loserLeadId !== input.approvedPlan.loserLeadId) {
        throw new MergeAbortedError("Live plan ids do not match the approved plan's ids.");
      }

      const nonCollisionBlockers = freshPlan.blockers.filter((b) => b.reason !== "COMMERCIAL_PROFILE_COLLISION");
      if (nonCollisionBlockers.length > 0) {
        throw new MergeAbortedError(`Unresolved blocker(s), no override exists: ${nonCollisionBlockers.map((b) => b.reason).join(", ")}.`);
      }
      if (!commercialProfileCollisionIsResolved(freshPlan, input.resolution)) {
        throw new MergeAbortedError("Commercial profile collision exists and is not covered by an approved resolution for this exact pair.");
      }

      if (!freshPlan.cardinality || !input.approvedPlan.cardinality) {
        throw new MergeAbortedError("No cardinality snapshot available — plan is not in an executable shape.");
      }
      if (!cardinalityBeforeMatches(freshPlan.cardinality, input.approvedPlan.cardinality)) {
        throw new MergeAbortedError("Live child (conversation/follow-up/outcome) counts have drifted from the approved plan's snapshot.");
      }

      const liveConversationIds = freshPlan.operations.conversations.map((c) => c.conversationId);
      const approvedConversationIds = input.approvedPlan.operations.conversations.map((c) => c.conversationId);
      if (!sameIds(liveConversationIds, approvedConversationIds)) {
        throw new MergeAbortedError("The loser's conversation IDs have drifted from the approved plan.");
      }

      const liveFollowUpIds = freshPlan.operations.followUps.map((f) => f.followUpId);
      const approvedFollowUpIds = input.approvedPlan.operations.followUps.map((f) => f.followUpId);
      if (!sameIds(liveFollowUpIds, approvedFollowUpIds)) {
        throw new MergeAbortedError("The loser's follow-up IDs have drifted from the approved plan.");
      }

      if (!freshPlan.normalizedPhone || freshPlan.normalizedPhone !== input.approvedPlan.normalizedPhone) {
        throw new MergeAbortedError("Canonical phone has drifted from the approved plan.");
      }
      const canonicalPhone = freshPlan.normalizedPhone;

      // 2. Reparent conversations.
      if (liveConversationIds.length > 0) {
        const r = await tx.conversation.updateMany({ where: { id: { in: liveConversationIds }, leadId: input.loserLeadId }, data: { leadId: input.survivorLeadId } });
        if (r.count !== liveConversationIds.length) {
          throw new MergeAbortedError(`Conversation reparent affected ${r.count} row(s), expected ${liveConversationIds.length}.`);
        }
      }

      // 3. Reparent follow-ups.
      if (liveFollowUpIds.length > 0) {
        const r = await tx.followUp.updateMany({ where: { id: { in: liveFollowUpIds }, leadId: input.loserLeadId }, data: { leadId: input.survivorLeadId } });
        if (r.count !== liveFollowUpIds.length) {
          throw new MergeAbortedError(`Follow-up reparent affected ${r.count} row(s), expected ${liveFollowUpIds.length}.`);
        }
      }

      // 4. Resolve the commercial profile — exactly per the (possibly
      // override-resolved) action. Conversations/follow-ups/outcomes are
      // preserved automatically by step 2 above; a profile is the one
      // child relation that sometimes must be explicitly discarded
      // (RESTRICT-constrained: Lead has no cascade delete for
      // LeadCommercialProfile, so a collision resolved to KEEP_SURVIVOR
      // requires an explicit delete of the loser's row before step 8 can
      // succeed — never a silent no-op the way the dry-run preview shows
      // it for the ordinary, non-colliding KEEP_SURVIVOR case).
      let commercialProfileAction: AppliedLeadMergeResult["commercialProfileAction"];
      if (freshPlan.operations.commercialProfile.action === "MOVE_LOSER_TO_SURVIVOR") {
        await tx.leadCommercialProfile.update({ where: { leadId: input.loserLeadId }, data: { leadId: input.survivorLeadId } });
        commercialProfileAction = "MOVE_LOSER_TO_SURVIVOR";
      } else if (freshPlan.operations.commercialProfile.action === "MANUAL_REVIEW_COLLISION") {
        // Only reachable because commercialProfileCollisionIsResolved passed above.
        await tx.leadCommercialProfile.delete({ where: { leadId: input.loserLeadId } });
        commercialProfileAction = "RESOLVED_COLLISION_KEEP_SURVIVOR";
      } else {
        commercialProfileAction = freshPlan.operations.commercialProfile.action; // KEEP_SURVIVOR or NO_PROFILE — no write needed
      }

      // 5. Assignment/name: never written. The survivor's existing values are the only ones that can ever apply.

      // 6. Canonicalize the survivor's phone.
      const survivorBefore = await tx.lead.findUnique({ where: { id: input.survivorLeadId }, select: { phone: true } });
      if (!survivorBefore) throw new MergeAbortedError("Survivor disappeared mid-transaction.");
      if (survivorBefore.phone !== canonicalPhone) {
        await tx.lead.update({ where: { id: input.survivorLeadId }, data: { phone: canonicalPhone } });
      }

      // 7. Verify intermediate state — the loser must have zero remaining child rows before it can be deleted (Lead's FKs are all ON DELETE RESTRICT, never cascade).
      const [remainingConversations, remainingFollowUps, remainingProfile] = await Promise.all([
        tx.conversation.count({ where: { leadId: input.loserLeadId } }),
        tx.followUp.count({ where: { leadId: input.loserLeadId } }),
        tx.leadCommercialProfile.count({ where: { leadId: input.loserLeadId } }),
      ]);
      if (remainingConversations !== 0 || remainingFollowUps !== 0 || remainingProfile !== 0) {
        throw new MergeAbortedError(
          `Loser still has child rows before deletion (conversations=${remainingConversations}, followUps=${remainingFollowUps}, profile=${remainingProfile}) — aborting.`,
        );
      }

      // 8. Delete the loser Lead — only reachable once every child row is confirmed gone.
      await tx.lead.delete({ where: { id: input.loserLeadId } });

      // 9. Verify final state.
      const [survivorConversationCount, survivorFollowUpCount, loserStillExists] = await Promise.all([
        tx.conversation.count({ where: { leadId: input.survivorLeadId } }),
        tx.followUp.count({ where: { leadId: input.survivorLeadId } }),
        tx.lead.findUnique({ where: { id: input.loserLeadId }, select: { id: true } }),
      ]);
      if (survivorConversationCount !== freshPlan.cardinality.expectedAfter.survivorConversationCount) {
        throw new MergeAbortedError(`Final survivor conversation count ${survivorConversationCount} != expected ${freshPlan.cardinality.expectedAfter.survivorConversationCount}.`);
      }
      if (survivorFollowUpCount !== freshPlan.cardinality.expectedAfter.survivorFollowUpCount) {
        throw new MergeAbortedError(`Final survivor follow-up count ${survivorFollowUpCount} != expected ${freshPlan.cardinality.expectedAfter.survivorFollowUpCount}.`);
      }
      if (loserStillExists) throw new MergeAbortedError("Loser lead still exists after delete — aborting.");

      const applied: AppliedLeadMergeResult = {
        applied: true,
        survivorLeadId: input.survivorLeadId,
        loserLeadId: input.loserLeadId,
        canonicalPhone,
        reparentedConversationIds: liveConversationIds,
        reparentedFollowUpIds: liveFollowUpIds,
        commercialProfileAction,
        finalSurvivorConversationCount: survivorConversationCount,
        finalSurvivorFollowUpCount: survivorFollowUpCount,
      };
      return applied;
    });
  } catch (error) {
    if (error instanceof MergeAbortedError) {
      return { applied: false, reason: error.message };
    }
    throw error;
  }
}
