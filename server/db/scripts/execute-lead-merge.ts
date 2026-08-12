import type { PrismaClientOrTransaction } from "../../persistence/prisma/client";
import { planLeadMerge, type MergePlan, type MergePostconditionCheck } from "./merge-remediation-plan";

// Kori Legacy Data Remediation v0 — Merge Executor v0, DRY-RUN ONLY.
//
// This module cannot make a production write. Not "won't by default" —
// cannot: `mode` is typed as the literal `"DRY_RUN"`, the only member of
// its union. There is no `"EXECUTE"` variant anywhere in this file, no
// flag, no environment variable, no CLI switch that changes that, and no
// internal helper function capable of calling a mutating Prisma method.
// Every "write" this module describes (writePreview below) is an inert
// plain-object description — {model, method, args} — never a real Prisma
// call. The real, SEPARATELY approved and SEPARATELY reviewed transactional
// executor is server/db/scripts/apply-lead-merge.ts, which reuses this
// module's own drift-detection logic before it ever writes — this file's
// job stays permanently read-only: calling this function can only ever
// read and describe, never act, by design, not merely by convention.

export type ExecutionMode = "DRY_RUN";

export type ExecutionBlockReason =
  | "PLAN_NOT_EXECUTABLE"
  | "IDS_DO_NOT_MATCH_APPROVED_PLAN"
  | "CHILD_COUNTS_DRIFTED"
  | "CONVERSATION_ID_MISSING"
  | "FOLLOW_UP_ID_MISSING";

export interface ExecutionPrecondition {
  key: string;
  description: string;
  status: "OK" | "FAILED";
}

/**
 * Purely descriptive — `operation` is plain data (never a real Prisma call
 * object, never awaited, never executed) so there is no code path by which
 * building this preview could touch the database. `null` operation means
 * "no write for this step" (e.g. KEEP_SURVIVOR needs none).
 */
export interface PlannedWriteStep {
  /** Matches the corresponding entry in MergePlan.transactionOrder (steps 2-9; step 1 is precondition re-validation, step 10 is the transaction commit — neither is a row write). */
  step: number;
  description: string;
  operation: { model: string; method: string; args: Record<string, unknown> } | null;
}

export interface ExecutionPreview {
  mode: ExecutionMode;
  /** Freshly re-generated at execution time — always the live state, never the (possibly stale) approvedPlan passed in. */
  plan: MergePlan;
  preconditionResults: ExecutionPrecondition[];
  writePreview: PlannedWriteStep[];
  expectedPostconditions: MergePostconditionCheck[];
  executable: boolean;
  blockReasons: ExecutionBlockReason[];
}

function cardinalityBeforeMatches(fresh: MergePlan["cardinality"], approved: MergePlan["cardinality"]): boolean {
  if (!fresh || !approved) return false;
  return (
    fresh.before.survivorConversationCount === approved.before.survivorConversationCount &&
    fresh.before.loserConversationCount === approved.before.loserConversationCount &&
    fresh.before.survivorFollowUpCount === approved.before.survivorFollowUpCount &&
    fresh.before.loserFollowUpCount === approved.before.loserFollowUpCount &&
    fresh.before.survivorOutcomeCount === approved.before.survivorOutcomeCount &&
    fresh.before.loserOutcomeCount === approved.before.loserOutcomeCount
  );
}

function missingIds(approvedIds: string[], freshIds: string[]): string[] {
  const freshSet = new Set(freshIds);
  return approvedIds.filter((id) => !freshSet.has(id));
}

function buildWritePreview(plan: MergePlan): PlannedWriteStep[] {
  if (!plan.cardinality) return []; // blocked before the pair was structurally valid — nothing to preview

  const conversationIds = plan.operations.conversations.map((c) => c.conversationId);
  const followUpIds = plan.operations.followUps.map((f) => f.followUpId);

  const steps: PlannedWriteStep[] = [
    {
      step: 2,
      description: `Reparent ${conversationIds.length} loser conversation(s) to the survivor.`,
      operation:
        conversationIds.length > 0
          ? { model: "conversation", method: "updateMany", args: { where: { id: { in: conversationIds } }, data: { leadId: plan.survivorLeadId } } }
          : null,
    },
    {
      step: 3,
      description: `Reparent ${followUpIds.length} loser follow-up(s) to the survivor.`,
      operation:
        followUpIds.length > 0
          ? { model: "followUp", method: "updateMany", args: { where: { id: { in: followUpIds } }, data: { leadId: plan.survivorLeadId } } }
          : null,
    },
    {
      step: 4,
      description: `Commercial profile: ${plan.operations.commercialProfile.action}. ${plan.operations.commercialProfile.detail}`,
      operation:
        plan.operations.commercialProfile.action === "MOVE_LOSER_TO_SURVIVOR"
          ? { model: "leadCommercialProfile", method: "update", args: { where: { leadId: plan.loserLeadId }, data: { leadId: plan.survivorLeadId } } }
          : null,
    },
    {
      step: 5,
      description: `Assignment/name: keep survivor's current values ("${plan.operations.name.survivorName}", agent=${plan.operations.assignment.survivorAssignedAgentId ?? "unassigned"}). No write.`,
      operation: null,
    },
    {
      step: 6,
      description: plan.operations.phone ? plan.operations.phone.detail : "No phone plan (blocked before this step).",
      operation:
        plan.operations.phone && plan.operations.phone.currentSurvivorPhone !== plan.operations.phone.targetCanonicalPhone
          ? { model: "lead", method: "update", args: { where: { id: plan.survivorLeadId }, data: { phone: plan.operations.phone.targetCanonicalPhone } } }
          : null,
    },
    {
      step: 7,
      description: `Verify: survivor conversations=${plan.cardinality.expectedAfter.survivorConversationCount}, survivor follow-ups=${plan.cardinality.expectedAfter.survivorFollowUpCount}, preserved outcomes=${plan.cardinality.expectedAfter.preservedOutcomeCount}, moved IDs belong to survivor, original survivor conversations still present. No write.`,
      operation: null,
    },
    {
      step: 8,
      description: `Delete loser Lead ${plan.loserLeadId}.`,
      operation: plan.operations.loserDeletion ? { model: "lead", method: "delete", args: { where: { id: plan.loserLeadId } } } : null,
    },
    {
      step: 9,
      description: "Final verification: one canonical Lead remains for the phone, live NEEDS_REPLY signal (if any) still visible, commercial profile still present, Kori no longer double-counts this customer. No write.",
      operation: null,
    },
  ];

  return steps;
}

/**
 * DRY_RUN ONLY — cannot write. Re-generates a fresh MergePlan from live
 * data and compares it against `approvedPlan` (the plan a human already
 * reviewed and approved) to catch drift since approval: leads that stopped
 * existing, moved businesses, changed phones, gained/lost blockers, or
 * whose child conversation/follow-up counts or specific IDs no longer
 * match what was approved. Returns an ExecutionPreview describing exactly
 * what a future executor WOULD do — never does any of it.
 *
 * Deviates from the originally suggested signature by requiring
 * `approvedPlan`: without a snapshot to compare the live state against,
 * "did anything drift since approval" isn't answerable — MergePlan's own
 * CHILD_COUNTS_MATCH_SNAPSHOT / IDS_MATCH_APPROVED_PAIR preconditions were
 * explicitly deferred to whichever executor exists; this is that executor.
 */
export async function executeLeadMerge(
  db: PrismaClientOrTransaction,
  input: { businessId: string; survivorLeadId: string; loserLeadId: string; mode: ExecutionMode; approvedPlan: MergePlan },
): Promise<ExecutionPreview> {
  const plan = await planLeadMerge(db, { businessId: input.businessId, survivorLeadId: input.survivorLeadId, loserLeadId: input.loserLeadId });

  const blockReasons: ExecutionBlockReason[] = [];
  const preconditionResults: ExecutionPrecondition[] = [];

  const idsMatchApproved =
    input.approvedPlan.businessId === input.businessId &&
    input.approvedPlan.survivorLeadId === input.survivorLeadId &&
    input.approvedPlan.loserLeadId === input.loserLeadId;
  preconditionResults.push({
    key: "IDS_MATCH_APPROVED_PLAN",
    description: "The businessId/survivorLeadId/loserLeadId passed to executeLeadMerge match the plan a human explicitly approved.",
    status: idsMatchApproved ? "OK" : "FAILED",
  });
  if (!idsMatchApproved) blockReasons.push("IDS_DO_NOT_MATCH_APPROVED_PLAN");

  preconditionResults.push({
    key: "PLAN_EXECUTABLE",
    description: "The freshly re-generated plan has zero blockers (no MANUAL_REVIEW condition, no missing/mismatched lead).",
    status: plan.executable ? "OK" : "FAILED",
  });
  if (!plan.executable) blockReasons.push("PLAN_NOT_EXECUTABLE");

  const countsMatch = cardinalityBeforeMatches(plan.cardinality, input.approvedPlan.cardinality);
  preconditionResults.push({
    key: "CHILD_COUNTS_MATCH_APPROVED_SNAPSHOT",
    description: "Live conversation/follow-up/outcome counts for both leads still match the approved plan's \"before\" snapshot — nothing changed since approval.",
    status: countsMatch ? "OK" : "FAILED",
  });
  if (!countsMatch) blockReasons.push("CHILD_COUNTS_DRIFTED");

  const approvedConversationIds = input.approvedPlan.operations.conversations.map((c) => c.conversationId);
  const missingConversationIds = missingIds(approvedConversationIds, plan.operations.conversations.map((c) => c.conversationId));
  preconditionResults.push({
    key: "PLANNED_CONVERSATION_IDS_STILL_EXIST",
    description: `Every conversation ID in the approved plan (${approvedConversationIds.length}) is still one of the loser's conversations right now.`,
    status: missingConversationIds.length === 0 ? "OK" : "FAILED",
  });
  if (missingConversationIds.length > 0) blockReasons.push("CONVERSATION_ID_MISSING");

  const approvedFollowUpIds = input.approvedPlan.operations.followUps.map((f) => f.followUpId);
  const missingFollowUpIds = missingIds(approvedFollowUpIds, plan.operations.followUps.map((f) => f.followUpId));
  preconditionResults.push({
    key: "PLANNED_FOLLOW_UP_IDS_STILL_EXIST",
    description: `Every follow-up ID in the approved plan (${approvedFollowUpIds.length}) is still one of the loser's follow-ups right now.`,
    status: missingFollowUpIds.length === 0 ? "OK" : "FAILED",
  });
  if (missingFollowUpIds.length > 0) blockReasons.push("FOLLOW_UP_ID_MISSING");

  const executable = blockReasons.length === 0;

  return {
    mode: input.mode,
    plan,
    preconditionResults,
    writePreview: buildWritePreview(plan),
    expectedPostconditions: plan.postconditions,
    executable,
    blockReasons,
  };
}
