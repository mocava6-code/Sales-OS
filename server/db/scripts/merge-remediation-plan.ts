import type { ConversationChannel, ConversationSource, ConversationStatus, CustomerTypeProfile, FollowUpStatus, LeadNextAction, OutcomeType } from "../generated/client";
import type { PrismaClientOrTransaction } from "../../persistence/prisma/client";
import { normalizeStoredPhoneForAudit } from "../../../lib/phone";

// Kori Legacy Data Remediation v0 — Merge Remediation v0, PLANNING ONLY.
//
// This module has exactly one capability: describe, in full and precise
// detail, what a merge of two duplicate Leads WOULD do. It has no execution
// capability at all — there is no code path in this file that creates,
// updates, or deletes a single row. planLeadMerge only ever issues read
// (`findUnique`) queries. The real, SEPARATELY approved and SEPARATELY
// reviewed atomic-transaction executor this plan is designed to feed is
// apply-lead-merge.ts — the only write-capable module in this toolchain;
// this file's own job is, and stays, producing a MergePlan for a human to
// read, never acting on one.
//
// No generalized "merge all duplicates" command, no automatic survivor
// selection, no bulk mode, no migration, no @@unique constraint, no
// production execution — all deliberately out of scope here.

export type MergeBlockerReason =
  | "LEAD_NOT_FOUND"
  | "SAME_LEAD"
  | "CROSS_BUSINESS"
  | "PHONE_MISMATCH"
  | "COMMERCIAL_PROFILE_COLLISION"
  | "ASSIGNED_AGENT_MISMATCH";

export interface MergePlanBlocker {
  reason: MergeBlockerReason;
  detail: string;
}

/** OK = verified true right now. DEFERRED = cannot be meaningfully checked until execution time, even though this plan exists. FAILED = already known false — the plan is not executable. */
export type PreconditionStatus = "OK" | "FAILED" | "DEFERRED_TO_EXECUTION";

export interface MergePrecondition {
  key: string;
  description: string;
  status: PreconditionStatus;
}

export interface MergePostconditionCheck {
  key: string;
  description: string;
  /** IDs this check is about, when it's an ID-level check (e.g. specific conversation/follow-up ids) — empty for checks that aren't about specific rows. */
  relatedIds: string[];
}

export interface ConversationReparentOp {
  conversationId: string;
  fromLeadId: string;
  toLeadId: string;
  entryCount: number;
  status: ConversationStatus;
  lastEntryAt: Date;
  channel: ConversationChannel;
  source: ConversationSource;
}

export interface FollowUpReparentOp {
  followUpId: string;
  fromLeadId: string;
  toLeadId: string;
  status: FollowUpStatus;
  dueAt: Date;
}

/**
 * NOT a real write operation — Outcome has no `leadId` column (it hangs
 * off DecisionRecord -> Conversation -> Lead). Once the Conversation it
 * belongs to is re-parented (ConversationReparentOp), every Outcome
 * (and DecisionRecord, DecisionEvent, AdvisorAction, ConversationEntry,
 * ConversationSnapshot, DomainEvent, Observation) hanging off it moves
 * with it automatically, with zero additional writes. Listed here purely
 * as a preserved-data inventory for the human reviewer, per requirement
 * #3 — not because it implies a separate database write.
 */
export interface OutcomeReparentObservation {
  outcomeId: string;
  decisionRecordId: string;
  viaConversationId: string;
  fromLeadId: string;
  toLeadId: string;
  outcomeType: OutcomeType;
  occurredAt: Date;
}

export interface CommercialProfileFieldSnapshot {
  vehicleBrand: string | null;
  vehicleModel: string | null;
  vehicleYear: number | null;
  productInterest: string | null;
  customerType: CustomerTypeProfile | null;
  nextAction: LeadNextAction | null;
  primaryObjection: string | null;
}

// KEEP_SURVIVOR / MOVE_LOSER_TO_SURVIVOR / NO_PROFILE name the SOURCE the
// surviving profile data comes from, never a direction that could be
// misread. "ADOPT_LOSER" was rejected: for the only-survivor-has-a-profile
// case it's not used at all, but the earlier "only-loser-has-a-profile"
// case's label could be misread as "keep the loser Lead" rather than
// "move the loser's profile data onto the survivor." There is no scenario
// where a profile is renamed to imply the loser Lead itself survives.
export type CommercialProfileAction = "KEEP_SURVIVOR" | "MOVE_LOSER_TO_SURVIVOR" | "NO_PROFILE" | "MANUAL_REVIEW_COLLISION";

export interface CommercialProfilePlan {
  action: CommercialProfileAction;
  survivorProfile: CommercialProfileFieldSnapshot | null;
  loserProfile: CommercialProfileFieldSnapshot | null;
  detail: string;
}

export interface AssignmentPlan {
  action: "KEEP_SURVIVOR_ASSIGNMENT" | "MANUAL_REVIEW_MISMATCH";
  survivorAssignedAgentId: string | null;
  loserAssignedAgentId: string | null;
  detail: string;
}

export interface NamePlan {
  action: "KEEP_SURVIVOR_NAME";
  survivorName: string;
  loserName: string;
  detail: string;
}

export interface PhonePlan {
  action: "PLANNED_NOT_EXECUTED";
  currentSurvivorPhone: string;
  targetCanonicalPhone: string;
  detail: string;
}

export interface LoserDeletionPlan {
  action: "PLANNED_AFTER_VALIDATION_NOT_EXECUTED";
  loserLeadId: string;
  detail: string;
}

export interface MergePlanOperations {
  conversations: ConversationReparentOp[];
  followUps: FollowUpReparentOp[];
  outcomes: OutcomeReparentObservation[];
  commercialProfile: CommercialProfilePlan;
  assignment: AssignmentPlan;
  name: NamePlan;
  phone: PhonePlan | null;
  loserDeletion: LoserDeletionPlan | null;
}

/**
 * Exact before/expected-after row counts for every relation a merge would
 * touch. "N rows moved" is NOT the same claim as "N rows total after the
 * merge" — expectedAfter always adds the survivor's own pre-existing rows
 * to the moved rows, so a future executor (and a human reading this plan)
 * can tell the two apart at a glance.
 */
export interface MergeCardinalitySnapshot {
  before: {
    survivorConversationCount: number;
    loserConversationCount: number;
    survivorFollowUpCount: number;
    loserFollowUpCount: number;
    survivorOutcomeCount: number;
    loserOutcomeCount: number;
  };
  expectedAfter: {
    /** before.survivorConversationCount + before.loserConversationCount */
    survivorConversationCount: number;
    /** before.survivorFollowUpCount + before.loserFollowUpCount */
    survivorFollowUpCount: number;
    /** before.survivorOutcomeCount + before.loserOutcomeCount — all now reachable via the survivor's conversations. */
    preservedOutcomeCount: number;
    /** Always 0 — the loser Lead is planned for deletion only once its own child counts are 0. */
    loserConversationCount: number;
    loserFollowUpCount: number;
    loserOutcomeCount: number;
  };
}

export interface MergePlan {
  generatedAt: Date;
  businessId: string;
  survivorLeadId: string;
  loserLeadId: string;
  /** Null when the two leads' phones don't agree (see PHONE_MISMATCH) or a lead couldn't be read. */
  normalizedPhone: string | null;
  /** Always true — this module has no execution capability at all. */
  dryRun: true;
  /** False whenever `blockers` is non-empty. A human must resolve every blocker before any future executor may run. */
  executable: boolean;
  blockers: MergePlanBlocker[];
  operations: MergePlanOperations;
  /** Null whenever the plan is blocked before either lead's child records could be safely read (missing lead, cross-business, phone mismatch). */
  cardinality: MergeCardinalitySnapshot | null;
  preconditions: MergePrecondition[];
  postconditions: MergePostconditionCheck[];
  /** Documents the contract a future executor must honor — not itself a transaction, since this module never writes. */
  transactionNote: string;
  /** The exact, ordered steps a future executor must follow inside one Prisma $transaction. Fixed regardless of this pair's data — see FUTURE_EXECUTOR_TRANSACTION_ORDER's doc comment. */
  transactionOrder: readonly string[];
}

interface FetchedLead {
  id: string;
  businessId: string;
  name: string;
  phone: string;
  assignedToUserId: string | null;
  commercialProfile: CommercialProfileFieldSnapshot | null;
  conversations: {
    id: string;
    channel: ConversationChannel;
    source: ConversationSource;
    status: ConversationStatus;
    lastEntryAt: Date;
    _count: { entries: number };
    decisionRecords: { id: string; outcomes: { id: string; outcomeType: OutcomeType; occurredAt: Date }[] }[];
  }[];
  followUps: { id: string; status: FollowUpStatus; dueAt: Date }[];
}

async function fetchLeadForMergePlan(db: PrismaClientOrTransaction, leadId: string): Promise<FetchedLead | null> {
  return db.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      businessId: true,
      name: true,
      phone: true,
      assignedToUserId: true,
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
        select: {
          id: true,
          channel: true,
          source: true,
          status: true,
          lastEntryAt: true,
          _count: { select: { entries: true } },
          decisionRecords: {
            select: {
              id: true,
              outcomes: { select: { id: true, outcomeType: true, occurredAt: true } },
            },
          },
        },
      },
      followUps: { select: { id: true, status: true, dueAt: true } },
    },
  });
}

function countOutcomes(lead: Pick<FetchedLead, "conversations">): number {
  return lead.conversations.reduce((sum, c) => sum + c.decisionRecords.reduce((s, dr) => s + dr.outcomes.length, 0), 0);
}

function emptyOperations(): MergePlanOperations {
  return {
    conversations: [],
    followUps: [],
    outcomes: [],
    commercialProfile: { action: "NO_PROFILE", survivorProfile: null, loserProfile: null, detail: "Not computed — plan is blocked before reaching this step." },
    assignment: { action: "KEEP_SURVIVOR_ASSIGNMENT", survivorAssignedAgentId: null, loserAssignedAgentId: null, detail: "Not computed — plan is blocked before reaching this step." },
    name: { action: "KEEP_SURVIVOR_NAME", survivorName: "", loserName: "", detail: "Not computed — plan is blocked before reaching this step." },
    phone: null,
    loserDeletion: null,
  };
}

const TRANSACTION_NOTE =
  "This module never writes anything — it only plans. server/db/scripts/apply-lead-merge.ts " +
  "applies every operation in this plan inside exactly one Prisma $transaction: all " +
  "Conversation/FollowUp re-parents, the Lead.phone normalization, and the loser Lead " +
  "deletion succeed together or none of them apply. Outcomes and their ancestors " +
  "(DecisionRecord, DecisionEvent, AdvisorAction, entries, snapshots, domain events, " +
  "observations) need no direct write — they move with their Conversation automatically " +
  "and are already covered by the Conversation re-parent.";

/**
 * v0 design decision, not yet built: there is no @@unique([businessId,
 * phone]) constraint today, so re-parenting/deleting and normalizing the
 * phone could technically happen in either order without a constraint
 * violation. This order is still fixed and intentional — validate first,
 * move child data before touching identity fields, verify counts/ids
 * BEFORE the irreversible loser deletion (step 8), and only normalize the
 * phone (step 6) once the merge is otherwise certain to complete. Any
 * failure at any step throws and rolls back the entire transaction — no
 * partial merge is ever left behind.
 */
const FUTURE_EXECUTOR_TRANSACTION_ORDER: readonly string[] = [
  "1. Re-read and validate all preconditions.",
  "2. Reparent loser conversations to survivor.",
  "3. Reparent loser follow-ups to survivor.",
  "4. Preserve/resolve commercial profile according to the explicit plan (never silently overwrite on collision).",
  "5. Preserve survivor assignment and name (never copy the loser's).",
  "6. Normalize survivor phone to canonical E.164.",
  "7. Verify intermediate child IDs/counts against this plan's cardinality snapshot.",
  "8. Delete the loser Lead.",
  "9. Verify final postconditions.",
  "10. Commit the transaction.",
  "If any verification fails at any step: throw and roll back the entire transaction. No partial merge.",
];

function blockedPlan(
  generatedAt: Date,
  input: { businessId: string; survivorLeadId: string; loserLeadId: string },
  blockers: MergePlanBlocker[],
  preconditions: MergePrecondition[],
  normalizedPhone: string | null,
): MergePlan {
  return {
    generatedAt,
    businessId: input.businessId,
    survivorLeadId: input.survivorLeadId,
    loserLeadId: input.loserLeadId,
    normalizedPhone,
    dryRun: true,
    executable: false,
    blockers,
    operations: emptyOperations(),
    cardinality: null,
    preconditions,
    postconditions: [],
    transactionNote: TRANSACTION_NOTE,
    transactionOrder: FUTURE_EXECUTOR_TRANSACTION_ORDER,
  };
}

/**
 * READ-ONLY. Produces a MergePlan describing exactly what merging
 * loserLeadId into survivorLeadId WOULD do — never writes anything.
 * `dryRun` is always `true`: there is no parameter, flag, or code path in
 * this module that can make it execute. Every finding here is advisory,
 * exactly like Phase B's survivorRecommendation — a human decides whether
 * (and how) to actually run apply-lead-merge.ts against this plan.
 */
export async function planLeadMerge(
  db: PrismaClientOrTransaction,
  input: { businessId: string; survivorLeadId: string; loserLeadId: string },
): Promise<MergePlan> {
  const generatedAt = new Date();
  const blockers: MergePlanBlocker[] = [];

  if (input.survivorLeadId === input.loserLeadId) {
    blockers.push({ reason: "SAME_LEAD", detail: "survivorLeadId and loserLeadId must refer to two different Leads." });
    return blockedPlan(generatedAt, input, blockers, [], null);
  }

  const [survivor, loser] = await Promise.all([fetchLeadForMergePlan(db, input.survivorLeadId), fetchLeadForMergePlan(db, input.loserLeadId)]);

  if (!survivor) blockers.push({ reason: "LEAD_NOT_FOUND", detail: `survivorLeadId=${input.survivorLeadId} does not exist.` });
  if (!loser) blockers.push({ reason: "LEAD_NOT_FOUND", detail: `loserLeadId=${input.loserLeadId} does not exist.` });

  const preconditions: MergePrecondition[] = [
    { key: "LEADS_EXIST", description: "Both survivorLeadId and loserLeadId exist.", status: survivor && loser ? "OK" : "FAILED" },
  ];

  if (!survivor || !loser) {
    return blockedPlan(generatedAt, input, blockers, preconditions, null);
  }

  const sameBusiness = survivor.businessId === input.businessId && loser.businessId === input.businessId && survivor.businessId === loser.businessId;
  preconditions.push({ key: "SAME_BUSINESS", description: "Both leads belong to businessId, and to the same businessId as each other.", status: sameBusiness ? "OK" : "FAILED" });
  if (!sameBusiness) {
    blockers.push({
      reason: "CROSS_BUSINESS",
      detail: `Expected businessId=${input.businessId}; survivor.businessId=${survivor.businessId}, loser.businessId=${loser.businessId}.`,
    });
  }

  let survivorPhone: string | null = null;
  let loserPhone: string | null = null;
  try {
    survivorPhone = normalizeStoredPhoneForAudit(survivor.phone);
  } catch {
    // Left null — handled by the mismatch check below.
  }
  try {
    loserPhone = normalizeStoredPhoneForAudit(loser.phone);
  } catch {
    // Left null — handled by the mismatch check below.
  }

  const phonesMatch = survivorPhone !== null && survivorPhone === loserPhone;
  preconditions.push({
    key: "PHONES_NORMALIZE_TO_SAME_E164",
    description: "Both leads' stored phone values normalize to the identical canonical E.164 number.",
    status: phonesMatch ? "OK" : "FAILED",
  });
  if (!phonesMatch) {
    blockers.push({
      reason: "PHONE_MISMATCH",
      detail: `survivor "${survivor.phone}" normalized to ${survivorPhone ?? "(unparseable)"}, loser "${loser.phone}" normalized to ${loserPhone ?? "(unparseable)"} — these must match exactly for this pair to be a valid merge candidate.`,
    });
  }

  if (!sameBusiness || !phonesMatch) {
    return blockedPlan(generatedAt, input, blockers, preconditions, phonesMatch ? survivorPhone : null);
  }

  // From here on the pair is structurally valid (same business, same real
  // phone) — build the full descriptive plan even if a MANUAL_REVIEW
  // blocker still makes it non-executable, so a human reviewer sees
  // everything, not just the reason it's blocked.

  const conversations: ConversationReparentOp[] = loser.conversations.map((c) => ({
    conversationId: c.id,
    fromLeadId: loser.id,
    toLeadId: survivor.id,
    entryCount: c._count.entries,
    status: c.status,
    lastEntryAt: c.lastEntryAt,
    channel: c.channel,
    source: c.source,
  }));

  const followUps: FollowUpReparentOp[] = loser.followUps.map((f) => ({
    followUpId: f.id,
    fromLeadId: loser.id,
    toLeadId: survivor.id,
    status: f.status,
    dueAt: f.dueAt,
  }));

  const outcomes: OutcomeReparentObservation[] = loser.conversations.flatMap((c) =>
    c.decisionRecords.flatMap((dr) =>
      dr.outcomes.map((o) => ({
        outcomeId: o.id,
        decisionRecordId: dr.id,
        viaConversationId: c.id,
        fromLeadId: loser.id,
        toLeadId: survivor.id,
        outcomeType: o.outcomeType,
        occurredAt: o.occurredAt,
      })),
    ),
  );

  const survivorHasProfile = survivor.commercialProfile !== null;
  const loserHasProfile = loser.commercialProfile !== null;
  let commercialProfile: CommercialProfilePlan;
  if (survivorHasProfile && loserHasProfile) {
    commercialProfile = {
      action: "MANUAL_REVIEW_COLLISION",
      survivorProfile: survivor.commercialProfile,
      loserProfile: loser.commercialProfile,
      detail:
        "Both leads have a LeadCommercialProfile. No deterministic field-level merge policy is approved yet, so this is never silently resolved — a human must decide field-by-field before any executor may run.",
    };
    blockers.push({ reason: "COMMERCIAL_PROFILE_COLLISION", detail: "Both survivor and loser have a LeadCommercialProfile — see operations.commercialProfile for both snapshots." });
  } else if (survivorHasProfile) {
    commercialProfile = {
      action: "KEEP_SURVIVOR",
      survivorProfile: survivor.commercialProfile,
      loserProfile: null,
      detail: "Only the survivor has a commercial profile — preserved unchanged, sourced from the survivor. Nothing to merge.",
    };
  } else if (loserHasProfile) {
    commercialProfile = {
      action: "MOVE_LOSER_TO_SURVIVOR",
      survivorProfile: null,
      loserProfile: loser.commercialProfile,
      detail: "Only the loser has a commercial profile — a future executor would re-parent it (LeadCommercialProfile.leadId is @unique per Lead) onto the survivor rather than discard it.",
    };
  } else {
    commercialProfile = {
      action: "NO_PROFILE",
      survivorProfile: null,
      loserProfile: null,
      detail: "Neither lead has a commercial profile. Nothing to do.",
    };
  }

  const assignmentDiffers = survivor.assignedToUserId !== loser.assignedToUserId;
  const assignment: AssignmentPlan = assignmentDiffers
    ? {
        action: "MANUAL_REVIEW_MISMATCH",
        survivorAssignedAgentId: survivor.assignedToUserId,
        loserAssignedAgentId: loser.assignedToUserId,
        detail: "survivor and loser have different assignedToUserId values. Never chosen automatically — a human must decide which agent (if either) should own the merged Lead.",
      }
    : {
        action: "KEEP_SURVIVOR_ASSIGNMENT",
        survivorAssignedAgentId: survivor.assignedToUserId,
        loserAssignedAgentId: loser.assignedToUserId,
        detail: "Both leads have the same assignedToUserId (including both unassigned) — nothing to reconcile.",
      };
  if (assignmentDiffers) {
    blockers.push({ reason: "ASSIGNED_AGENT_MISMATCH", detail: `survivor.assignedToUserId=${survivor.assignedToUserId ?? "null"}, loser.assignedToUserId=${loser.assignedToUserId ?? "null"}.` });
  }

  const name: NamePlan = {
    action: "KEEP_SURVIVOR_NAME",
    survivorName: survivor.name,
    loserName: loser.name,
    detail:
      "The survivor's current name is always kept — the loser's name is never copied, since a non-placeholder name is not proof of a real customer identity (see server/db/scripts/audit-duplicate-lead-phones.ts's survivor-ranking criterion doc). The existing WhatsApp profile-name upgrade mechanism (applyWhatsAppContactName) can still populate a real name later from a genuine inbound contact name.",
  };

  const canonicalPhone = survivorPhone as string; // phonesMatch guarantees non-null here
  const phone: PhonePlan = {
    action: "PLANNED_NOT_EXECUTED",
    currentSurvivorPhone: survivor.phone,
    targetCanonicalPhone: canonicalPhone,
    detail:
      survivor.phone === canonicalPhone
        ? "Survivor's stored phone is already the canonical E.164 form — no change needed."
        : `Survivor's stored phone ("${survivor.phone}") would eventually be normalized to the canonical form ("${canonicalPhone}") by a future executor. Not applied by this plan.`,
  };

  const loserDeletion: LoserDeletionPlan = {
    action: "PLANNED_AFTER_VALIDATION_NOT_EXECUTED",
    loserLeadId: loser.id,
    detail:
      "A future executor would only delete this Lead after every conversation and follow-up above is confirmed re-parented and every postcondition below is confirmed true — never before, and never as part of this plan.",
  };

  const before: MergeCardinalitySnapshot["before"] = {
    survivorConversationCount: survivor.conversations.length,
    loserConversationCount: loser.conversations.length,
    survivorFollowUpCount: survivor.followUps.length,
    loserFollowUpCount: loser.followUps.length,
    survivorOutcomeCount: countOutcomes(survivor),
    loserOutcomeCount: countOutcomes(loser),
  };
  const cardinality: MergeCardinalitySnapshot = {
    before,
    expectedAfter: {
      survivorConversationCount: before.survivorConversationCount + before.loserConversationCount,
      survivorFollowUpCount: before.survivorFollowUpCount + before.loserFollowUpCount,
      preservedOutcomeCount: before.survivorOutcomeCount + before.loserOutcomeCount,
      loserConversationCount: 0,
      loserFollowUpCount: 0,
      loserOutcomeCount: 0,
    },
  };

  preconditions.push(
    {
      key: "CHILD_COUNTS_MATCH_SNAPSHOT",
      description: `At execution time, the loser's live conversation/follow-up/outcome counts must exactly match this plan's "before" snapshot (conversations=${before.loserConversationCount}, followUps=${before.loserFollowUpCount}, outcomes=${before.loserOutcomeCount}) — if anything changed since this plan was generated, abort with zero writes and re-plan.`,
      status: "DEFERRED_TO_EXECUTION",
    },
    {
      key: "IDS_MATCH_APPROVED_PAIR",
      description: `Execution must be invoked with exactly survivorLeadId=${survivor.id} and loserLeadId=${loser.id} — the pair a human explicitly approved for this plan, never a different pair or a re-derived recommendation.`,
      status: "DEFERRED_TO_EXECUTION",
    },
  );

  const conversationIds = conversations.map((c) => c.conversationId);
  const followUpIds = followUps.map((f) => f.followUpId);
  const outcomeIds = outcomes.map((o) => o.outcomeId);
  const survivorPreExistingConversationIds = survivor.conversations.map((c) => c.id);

  const postconditions: MergePostconditionCheck[] = [
    {
      key: "SINGLE_LEAD_FOR_PHONE",
      description: `Exactly one Lead remains for canonical phone ${canonicalPhone} within businessId=${input.businessId}.`,
      relatedIds: [survivor.id],
    },
    {
      key: "CONVERSATION_IDS_EXIST",
      description: "Every planned (loser) conversation ID still exists after the merge.",
      relatedIds: conversationIds,
    },
    {
      key: "CONVERSATION_IDS_BELONG_TO_SURVIVOR",
      description: `Every planned conversation ID above has leadId=${survivor.id} after the merge.`,
      relatedIds: conversationIds,
    },
    {
      key: "FOLLOW_UP_IDS_EXIST",
      description: "Every planned (loser) follow-up ID still exists after the merge, including any already DONE/SNOOZED, not just PENDING.",
      relatedIds: followUpIds,
    },
    {
      key: "FOLLOW_UP_IDS_BELONG_TO_SURVIVOR",
      description: `Every planned follow-up ID above has leadId=${survivor.id} after the merge.`,
      relatedIds: followUpIds,
    },
    {
      key: "SURVIVOR_PRE_EXISTING_CONVERSATIONS_REMAIN",
      description: "The survivor's own pre-existing conversation IDs (not part of the re-parent) remain present and unchanged after the merge.",
      relatedIds: survivorPreExistingConversationIds,
    },
    {
      key: "CARDINALITY_MATCHES_EXPECTED_AFTER",
      description: `Post-merge counts equal this plan's expectedAfter, not just "N rows moved": survivor conversations=${cardinality.expectedAfter.survivorConversationCount}, survivor follow-ups=${cardinality.expectedAfter.survivorFollowUpCount}, preserved outcomes=${cardinality.expectedAfter.preservedOutcomeCount}, loser conversations=0, loser follow-ups=0, loser outcomes=0.`,
      relatedIds: [],
    },
    {
      key: "COMMERCIAL_PROFILE_RESOLVED",
      description: "The commercial profile is preserved and queryable under the survivor per operations.commercialProfile's resolved action (KEEP_SURVIVOR / MOVE_LOSER_TO_SURVIVOR / NO_PROFILE).",
      relatedIds: [],
    },
    {
      key: "OUTCOME_IDS_PRESERVED",
      description: "Every planned outcome ID remains reachable (via the survivor's conversations) after the merge.",
      relatedIds: outcomeIds,
    },
    {
      key: "NEEDS_REPLY_VISIBILITY_PRESERVED",
      description: "If the survivor had a live NEEDS_REPLY conversation before the merge, that same conversation still reports NEEDS_REPLY under the survivor after it.",
      relatedIds: [],
    },
    {
      key: "KORI_NO_LONGER_DOUBLE_COUNTS",
      description: "Kori's needsReply/lead-count queries (server/kori/query-executor.ts) no longer count this phone number as two separate leads.",
      relatedIds: [survivor.id],
    },
  ];

  return {
    generatedAt,
    businessId: input.businessId,
    survivorLeadId: survivor.id,
    loserLeadId: loser.id,
    normalizedPhone: canonicalPhone,
    dryRun: true,
    executable: blockers.length === 0,
    blockers,
    operations: { conversations, followUps, outcomes, commercialProfile, assignment, name, phone, loserDeletion },
    cardinality,
    preconditions,
    postconditions,
    transactionNote: TRANSACTION_NOTE,
    transactionOrder: FUTURE_EXECUTOR_TRANSACTION_ORDER,
  };
}
