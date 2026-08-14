import { prisma } from "@/server/db/client";
import { Prisma } from "@/server/db/generated/client";
import type { CustomerTypeProfile, LeadNextAction, PrismaClient } from "@/server/db/generated/client";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";
import { PrismaConversationSnapshotRepository } from "@/server/persistence/prisma/prisma-conversation-snapshot-repository";
import { buildLeadCommercialState } from "@/server/lead-commercial-state/build-lead-commercial-state";
import { getLead } from "./lead-service";

// Reconciles the two fragmented commercial-fact sources — see
// server/db/schema.prisma's LeadCommercialProfile doc comment for why this
// table exists. Neither source is Prisma-free here (getLead and
// buildLeadCommercialState both are, but this file is the one place that
// binds them to real persistence) — same layering role
// server/orchestration/** plays for the engines it coordinates.

export const LEAD_COMMERCIAL_PROFILE_CONFIDENCE_THRESHOLD = 0.6;

export type LeadCommercialProfileFieldSource = "CONVERSATION_SNAPSHOT" | "LEAD_COMMERCIAL_STATE" | "EXISTING";

export interface FieldProvenance {
  source: LeadCommercialProfileFieldSource;
  confidence: number | null;
  snapshotId: string | null;
  updatedAt: string;
}

export interface LeadCommercialProfileProvenance {
  vehicleBrand?: FieldProvenance;
  vehicleModel?: FieldProvenance;
  vehicleYear?: FieldProvenance;
  productInterest?: FieldProvenance;
  customerType?: FieldProvenance;
  /** Covers nextActionReason too — the pair is always resolved and written together. */
  nextAction?: FieldProvenance;
  primaryObjection?: FieldProvenance;
}

export interface LeadCommercialProfileFields {
  vehicleBrand: string;
  vehicleModel: string;
  vehicleYear: number;
  productInterest: string;
  customerType: CustomerTypeProfile;
  nextAction: LeadNextAction;
  nextActionReason: string | null;
  primaryObjection: string;
}

interface FieldCandidate<T> {
  value: T;
  confidence: number;
  source: "CONVERSATION_SNAPSHOT" | "LEAD_COMMERCIAL_STATE";
  snapshotId: string | null;
  reasoning?: string | null;
}

/** Tier 2 gate: value !== null AND confidence >= threshold, else no candidate at all. */
function buildTier2Candidate<T>(field: { value: T | null; confidence: number }, snapshotId: string): FieldCandidate<T> | null {
  if (field.value === null || field.confidence < LEAD_COMMERCIAL_PROFILE_CONFIDENCE_THRESHOLD) return null;
  return { value: field.value, confidence: field.confidence, source: "CONVERSATION_SNAPSHOT", snapshotId };
}

/** Tier 3 gate: value !== null only — deterministic/rule-based, no confidence viability gate. */
function buildTier3Candidate<T>(field: { value: T | null; confidence: number; reasoning: string | null }): FieldCandidate<T> | null {
  if (field.value === null) return null;
  return { value: field.value, confidence: field.confidence, source: "LEAD_COMMERCIAL_STATE", snapshotId: null, reasoning: field.reasoning };
}

/**
 * tier2/tier3 must already be gated (buildTier2Candidate/buildTier3Candidate)
 * — this performs no validity checking of its own, only precedence + the
 * overwrite comparison. Returns null to mean "no change, leave the column
 * untouched" — the mechanism guaranteeing a null/missing candidate can never
 * be mistaken for "delete the existing value."
 */
export function resolveField<T>(
  existingConfidence: number | null | undefined,
  tier2: FieldCandidate<T> | null,
  tier3: FieldCandidate<T> | null,
): { value: T; confidence: number; source: FieldCandidate<T>["source"]; snapshotId: string | null; reasoning?: string | null } | null {
  const candidate = tier2 ?? tier3; // tier 2 wins when both valid — EXCEPT nextAction, enforced at the call site below
  if (!candidate) return null;

  const existing = existingConfidence ?? -1; // sentinel: "never set" always loses to any real candidate
  if (candidate.confidence < existing) return null; // strictly lower confidence — reject, keep existing

  return candidate;
}

export interface ComputeLeadCommercialProfileUpdateResult {
  hasChanges: boolean;
  rowExisted: boolean;
  fields: Partial<LeadCommercialProfileFields>;
  provenance: LeadCommercialProfileProvenance;
}

/**
 * Pure read+compute, no write — the shared core both projectLeadCommercialProfile
 * and the backfill script's dry-run mode call. Safe to call on a lead with
 * zero conversations (returns no-op) — deriveLeadCommercialState would
 * otherwise throw NoConversationsForLeadError on an empty conversations
 * array, so this never calls buildLeadCommercialState in that case.
 */
export async function computeLeadCommercialProfileUpdate(
  businessId: string,
  leadId: string,
  db: PrismaClientOrTransaction = prisma,
): Promise<ComputeLeadCommercialProfileUpdateResult> {
  const lead = await getLead(businessId, leadId, db);
  if (!lead) {
    throw new Error("Lead not found.");
  }

  if (lead.conversations.length === 0) {
    return { hasChanges: false, rowExisted: false, fields: {}, provenance: {} };
  }

  const existing = await db.leadCommercialProfile.findUnique({ where: { leadId } });
  const rowExisted = existing !== null;
  const existingProvenance = (existing?.provenance ?? {}) as LeadCommercialProfileProvenance;

  // Most recently touched conversation — see schema.prisma's flagged phase-1
  // asymmetry against buildLeadCommercialState's own (stricter,
  // non-CLOSED-preferring) active-conversation resolution.
  const activeConversationId = lead.conversations[0].id;
  const snapshot = await new PrismaConversationSnapshotRepository(db as PrismaClient).findLatestForConversation(activeConversationId);
  const dto = buildLeadCommercialState(lead, lead.business.timezone);

  const fields: Partial<LeadCommercialProfileFields> = {};
  const provenance: LeadCommercialProfileProvenance = {};
  const now = new Date().toISOString();

  function apply<K extends keyof LeadCommercialProfileFields>(
    key: K,
    tier2: FieldCandidate<LeadCommercialProfileFields[K]> | null,
    tier3: FieldCandidate<LeadCommercialProfileFields[K]> | null,
  ) {
    const resolved = resolveField(existingProvenance[key as keyof LeadCommercialProfileProvenance]?.confidence, tier2, tier3);
    if (!resolved) return;
    // Idempotency: a candidate that wins the confidence comparison but
    // resolves to the SAME value already stored is not a real change — a
    // deterministic tier-3 field (e.g. nextAction, re-derived identically
    // from conversation.status on every call) must not count as "updated"
    // just because it was re-resolved with the same value/confidence.
    if (existing && existing[key] === resolved.value) return;
    fields[key] = resolved.value;
    provenance[key as keyof LeadCommercialProfileProvenance] = {
      source: resolved.source,
      confidence: resolved.confidence,
      snapshotId: resolved.snapshotId,
      updatedAt: now,
    };
  }

  if (snapshot) {
    apply(
      "vehicleBrand",
      buildTier2Candidate(snapshot.result.facts.vehicleBrand, snapshot.id),
      // Kori Data Correctness Phase 1C — deterministic brand inference now
      // contributes here too (previously always null). resolveField's own
      // confidence comparison is what stops this from ever overwriting a
      // higher-confidence AI/human value already stored — no new guard
      // needed, this is the exact mechanism the plan reasoned it would be.
      buildTier3Candidate({ value: dto.vehicleBrand.value, confidence: dto.vehicleBrand.confidence, reasoning: dto.vehicleBrand.reasoning }),
    );
    apply(
      "vehicleModel",
      buildTier2Candidate(snapshot.result.facts.vehicleModel, snapshot.id),
      buildTier3Candidate({ value: dto.vehicleModel.value, confidence: dto.vehicleModel.confidence, reasoning: dto.vehicleModel.reasoning }),
    );
    apply(
      "vehicleYear",
      buildTier2Candidate(snapshot.result.facts.vehicleYear, snapshot.id),
      buildTier3Candidate({ value: dto.vehicleYear.value, confidence: dto.vehicleYear.confidence, reasoning: dto.vehicleYear.reasoning }),
    );
    apply(
      "productInterest",
      buildTier2Candidate(snapshot.result.facts.productRequested, snapshot.id),
      buildTier3Candidate({ value: dto.productInterest.value, confidence: dto.productInterest.confidence, reasoning: dto.productInterest.reasoning }),
    );
    apply(
      "customerType",
      buildTier2Candidate(snapshot.result.inferences.customerType, snapshot.id),
      // Previously always null — see extractors/customer-type-extractor.ts.
      // Same resolveField precedence as vehicleBrand/Model/Year: tier 2
      // (AI) wins outright when present, tier 3 only fills a genuine gap.
      buildTier3Candidate({ value: dto.customerType.value, confidence: dto.customerType.confidence, reasoning: dto.customerType.reasoning }),
    );

    const primaryObjectionSignal = [...snapshot.result.objections].sort((a, b) => b.confidence - a.confidence)[0];
    apply(
      "primaryObjection",
      primaryObjectionSignal
        ? buildTier2Candidate({ value: primaryObjectionSignal.objection, confidence: primaryObjectionSignal.confidence }, snapshot.id)
        : null,
      null,
    );
  } else {
    // No snapshot yet — tier 3 still contributes to all five overlapping fields.
    apply(
      "vehicleBrand",
      null,
      buildTier3Candidate({ value: dto.vehicleBrand.value, confidence: dto.vehicleBrand.confidence, reasoning: dto.vehicleBrand.reasoning }),
    );
    apply(
      "vehicleModel",
      null,
      buildTier3Candidate({ value: dto.vehicleModel.value, confidence: dto.vehicleModel.confidence, reasoning: dto.vehicleModel.reasoning }),
    );
    apply(
      "vehicleYear",
      null,
      buildTier3Candidate({ value: dto.vehicleYear.value, confidence: dto.vehicleYear.confidence, reasoning: dto.vehicleYear.reasoning }),
    );
    apply(
      "productInterest",
      null,
      buildTier3Candidate({ value: dto.productInterest.value, confidence: dto.productInterest.confidence, reasoning: dto.productInterest.reasoning }),
    );
    apply(
      "customerType",
      null,
      buildTier3Candidate({ value: dto.customerType.value, confidence: dto.customerType.confidence, reasoning: dto.customerType.reasoning }),
    );
  }

  // nextAction/nextActionReason: tier 3 ONLY — tier 2's recommendedNextAction.action
  // is free text, not a member of LeadNextAction's domain (see schema.prisma's
  // doc comment on the LeadNextAction enum). Deliberately never passed as tier2 here.
  const nextActionCandidate = buildTier3Candidate({ value: dto.nextAction.value, confidence: dto.nextAction.confidence, reasoning: dto.nextAction.reasoning });
  const resolvedNextAction = resolveField(existingProvenance.nextAction?.confidence, null, nextActionCandidate);
  // Same idempotency guard as apply() — nextAction is re-derived identically
  // from conversation.status on every call, so a same-value resolution must
  // not count as a change.
  if (resolvedNextAction && !(existing && existing.nextAction === resolvedNextAction.value)) {
    fields.nextAction = resolvedNextAction.value;
    fields.nextActionReason = resolvedNextAction.reasoning ?? null;
    provenance.nextAction = {
      source: resolvedNextAction.source,
      confidence: resolvedNextAction.confidence,
      snapshotId: resolvedNextAction.snapshotId,
      updatedAt: now,
    };
  }

  return { hasChanges: Object.keys(fields).length > 0, rowExisted, fields, provenance };
}

export interface ProjectLeadCommercialProfileResult {
  created: boolean;
  updated: boolean;
  skipped: boolean;
}

/**
 * Race-safe against two concurrent projections of the same lead — wraps the
 * read+compute+write in one transaction and uses upsert() rather than a
 * manual create/update branch, so the write itself is atomic at the
 * database level regardless of transaction isolation. Never catches/swallows
 * errors — genuine failures propagate; the caller (server/whatsapp/gateway.ts)
 * is what applies best-effort semantics, matching runAnalysis's contract.
 */
export async function projectLeadCommercialProfile(
  businessId: string,
  leadId: string,
  db: PrismaClient = prisma,
): Promise<ProjectLeadCommercialProfileResult> {
  return db.$transaction(async (tx) => {
    const update = await computeLeadCommercialProfileUpdate(businessId, leadId, tx);
    if (!update.hasChanges) {
      return { created: false, updated: false, skipped: true };
    }

    const existing = await tx.leadCommercialProfile.findUnique({ where: { leadId }, select: { provenance: true } });
    const mergedProvenance: LeadCommercialProfileProvenance = {
      ...((existing?.provenance ?? {}) as LeadCommercialProfileProvenance),
      ...update.provenance,
    };

    await tx.leadCommercialProfile.upsert({
      where: { leadId },
      create: { leadId, businessId, ...update.fields, provenance: mergedProvenance as unknown as Prisma.InputJsonValue },
      update: { ...update.fields, provenance: mergedProvenance as unknown as Prisma.InputJsonValue },
    });

    return { created: !update.rowExisted, updated: update.rowExisted, skipped: false };
  });
}
