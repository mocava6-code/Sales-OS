// Gated: proves planLeadMerge (Kori Legacy Data Remediation v0, Merge
// Remediation v0 — PLANNING ONLY) against real Postgres (sales_os_test).
// Covers the exact production shape found for +51933517901, every
// preserved-data category, both MANUAL_REVIEW collision paths, every
// reject path, and — critically — that this module never writes anything.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planLeadMerge } from "../merge-remediation-plan";
import { cleanupTestFixture, createDecisionRecordFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "../../../persistence/__tests__/test-db";

describe.skipIf(!shouldRunDbTests)("planLeadMerge (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "merge-plan"); // base lead: phone "+10000000000", unused by these tests
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
  });

  it("the exact known production shape: survivor has a live NEEDS_REPLY conversation + commercial profile, loser has older conversations/follow-up and no profile — executable, no blockers", async () => {
    const survivor = await db!.lead.create({ data: { businessId: fixture.businessId, name: "prueba", phone: "+51933517901" } });
    const loser = await db!.lead.create({ data: { businessId: fixture.businessId, name: "51933517901", phone: "51933517901" } });

    await db!.leadCommercialProfile.create({
      data: { leadId: survivor.id, businessId: fixture.businessId, vehicleModel: "Hilux TRAVO 2022", productInterest: "Hilux TRAVO 2022 kit" },
    });
    const survivorConv = await db!.conversation.create({
      data: {
        businessId: fixture.businessId,
        leadId: survivor.id,
        source: "MANUAL_PASTE",
        status: "NEEDS_REPLY",
        lastEntryAt: new Date(),
        lastEntryDirection: "INBOUND",
        createdByUserId: fixture.userId,
      },
    });
    const loserConv1 = await db!.conversation.create({
      data: {
        businessId: fixture.businessId,
        leadId: loser.id,
        source: "MANUAL_PASTE",
        status: "WAITING_ON_CUSTOMER",
        lastEntryAt: new Date("2026-07-24T00:00:00Z"),
        lastEntryDirection: "OUTBOUND",
        createdByUserId: fixture.userId,
      },
    });
    // Real production shape: the loser has TWO conversations, not one — this
    // is exactly what Issue 2 required a cardinality snapshot to get right
    // ("2 moved" must not be conflated with "2 total after merge").
    const loserConv2 = await db!.conversation.create({
      data: {
        businessId: fixture.businessId,
        leadId: loser.id,
        source: "MANUAL_PASTE",
        status: "CLOSED",
        lastEntryAt: new Date("2026-07-10T00:00:00Z"),
        lastEntryDirection: "OUTBOUND",
        createdByUserId: fixture.userId,
      },
    });
    const loserFollowUp = await db!.followUp.create({ data: { leadId: loser.id, userId: fixture.userId, dueAt: new Date(), status: "PENDING" } });

    try {
      const plan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: survivor.id, loserLeadId: loser.id });

      expect(plan.dryRun).toBe(true);
      expect(plan.executable).toBe(true);
      expect(plan.blockers).toEqual([]);
      expect(plan.normalizedPhone).toBe("+51933517901");

      expect(plan.operations.conversations).toHaveLength(2);
      expect(plan.operations.conversations.map((c) => c.conversationId).sort()).toEqual([loserConv1.id, loserConv2.id].sort());
      expect(plan.operations.conversations.every((c) => c.fromLeadId === loser.id && c.toLeadId === survivor.id)).toBe(true);

      expect(plan.operations.followUps).toHaveLength(1);
      expect(plan.operations.followUps[0].followUpId).toBe(loserFollowUp.id);

      // Issue 1 — the corrected action vocabulary: for THIS pair, only the
      // survivor has a profile, so the action MUST be KEEP_SURVIVOR, never
      // a directional name that could be misread as favoring the loser.
      expect(plan.operations.commercialProfile.action).toBe("KEEP_SURVIVOR");
      expect(plan.operations.commercialProfile.survivorProfile?.vehicleModel).toBe("Hilux TRAVO 2022");

      expect(plan.operations.name.action).toBe("KEEP_SURVIVOR_NAME");
      expect(plan.operations.name.survivorName).toBe("prueba");
      expect(plan.operations.name.loserName).toBe("51933517901");

      expect(plan.operations.assignment.action).toBe("KEEP_SURVIVOR_ASSIGNMENT");
      expect(plan.operations.phone?.action).toBe("PLANNED_NOT_EXECUTED");
      expect(plan.operations.loserDeletion?.action).toBe("PLANNED_AFTER_VALIDATION_NOT_EXECUTED");

      // Issue 2 — exact before/expected-after cardinalities, matching the
      // real production numbers: 1 survivor conversation + 2 loser
      // conversations moved must total 3, never be reported as 2.
      expect(plan.cardinality).toEqual({
        before: {
          survivorConversationCount: 1,
          loserConversationCount: 2,
          survivorFollowUpCount: 0,
          loserFollowUpCount: 1,
          survivorOutcomeCount: 0,
          loserOutcomeCount: 0,
        },
        expectedAfter: {
          survivorConversationCount: 3,
          survivorFollowUpCount: 1,
          preservedOutcomeCount: 0,
          loserConversationCount: 0,
          loserFollowUpCount: 0,
          loserOutcomeCount: 0,
        },
      });

      // Issue 3 — ID-level postconditions, not just counts.
      const conversationIdsExist = plan.postconditions.find((p) => p.key === "CONVERSATION_IDS_EXIST")!;
      expect(conversationIdsExist.relatedIds.sort()).toEqual([loserConv1.id, loserConv2.id].sort());
      const conversationIdsBelongToSurvivor = plan.postconditions.find((p) => p.key === "CONVERSATION_IDS_BELONG_TO_SURVIVOR")!;
      expect(conversationIdsBelongToSurvivor.relatedIds.sort()).toEqual([loserConv1.id, loserConv2.id].sort());
      const followUpIdsExist = plan.postconditions.find((p) => p.key === "FOLLOW_UP_IDS_EXIST")!;
      expect(followUpIdsExist.relatedIds).toEqual([loserFollowUp.id]);
      const followUpIdsBelongToSurvivor = plan.postconditions.find((p) => p.key === "FOLLOW_UP_IDS_BELONG_TO_SURVIVOR")!;
      expect(followUpIdsBelongToSurvivor.relatedIds).toEqual([loserFollowUp.id]);
      const survivorPreExisting = plan.postconditions.find((p) => p.key === "SURVIVOR_PRE_EXISTING_CONVERSATIONS_REMAIN")!;
      expect(survivorPreExisting.relatedIds).toEqual([survivorConv.id]);

      // Issue 4 — the future executor's exact intended order is documented on every plan.
      expect(plan.transactionOrder[0]).toContain("1. Re-read and validate all preconditions.");
      expect(plan.transactionOrder[5]).toContain("6. Normalize survivor phone to canonical E.164.");
      expect(plan.transactionOrder[7]).toContain("8. Delete the loser Lead.");
      expect(plan.transactionOrder.at(-1)).toContain("No partial merge");

      // Nothing was actually re-parented or deleted — this is a plan, not an execution.
      const stillTwoLeads = await db!.lead.count({ where: { businessId: fixture.businessId, phone: { in: ["+51933517901", "51933517901"] } } });
      expect(stillTwoLeads).toBe(2);
      const conversationStillOnLoser = await db!.conversation.findUnique({ where: { id: loserConv1.id } });
      expect(conversationStillOnLoser?.leadId).toBe(loser.id);
    } finally {
      await db!.followUp.deleteMany({ where: { leadId: { in: [survivor.id, loser.id] } } });
      await db!.conversationEntry.deleteMany({ where: { conversationId: { in: [survivorConv.id, loserConv1.id, loserConv2.id] } } });
      await db!.conversation.deleteMany({ where: { id: { in: [survivorConv.id, loserConv1.id, loserConv2.id] } } });
      await db!.leadCommercialProfile.deleteMany({ where: { leadId: survivor.id } });
      await db!.lead.deleteMany({ where: { id: { in: [survivor.id, loser.id] } } });
    }
  });

  it("Issue 1 — only the loser has a profile: action is MOVE_LOSER_TO_SURVIVOR, never a name implying the loser Lead survives", async () => {
    const survivor = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Real Name", phone: "+51900000021" } });
    const loser = await db!.lead.create({ data: { businessId: fixture.businessId, name: "51900000021", phone: "51900000021" } });
    await db!.leadCommercialProfile.create({ data: { leadId: loser.id, businessId: fixture.businessId, vehicleBrand: "Ford" } });

    try {
      const plan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: survivor.id, loserLeadId: loser.id });
      expect(plan.executable).toBe(true);
      expect(plan.operations.commercialProfile.action).toBe("MOVE_LOSER_TO_SURVIVOR");
      expect(plan.operations.commercialProfile.loserProfile?.vehicleBrand).toBe("Ford");
      expect(plan.operations.commercialProfile.survivorProfile).toBeNull();
    } finally {
      await db!.leadCommercialProfile.deleteMany({ where: { leadId: loser.id } });
      await db!.lead.deleteMany({ where: { id: { in: [survivor.id, loser.id] } } });
    }
  });

  it("Issue 1 — neither lead has a profile: action is NO_PROFILE", async () => {
    const survivor = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Real Name", phone: "+51900000022" } });
    const loser = await db!.lead.create({ data: { businessId: fixture.businessId, name: "51900000022", phone: "51900000022" } });

    try {
      const plan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: survivor.id, loserLeadId: loser.id });
      expect(plan.operations.commercialProfile.action).toBe("NO_PROFILE");
    } finally {
      await db!.lead.deleteMany({ where: { id: { in: [survivor.id, loser.id] } } });
    }
  });

  it("preserves DONE and SNOOZED follow-ups, not just PENDING", async () => {
    const survivor = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Real Name", phone: "+51900000010" } });
    const loser = await db!.lead.create({ data: { businessId: fixture.businessId, name: "51900000010", phone: "51900000010" } });

    const done = await db!.followUp.create({ data: { leadId: loser.id, userId: fixture.userId, dueAt: new Date(), status: "DONE" } });
    const snoozed = await db!.followUp.create({ data: { leadId: loser.id, userId: fixture.userId, dueAt: new Date(), status: "SNOOZED" } });
    const pending = await db!.followUp.create({ data: { leadId: loser.id, userId: fixture.userId, dueAt: new Date(), status: "PENDING" } });

    try {
      const plan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: survivor.id, loserLeadId: loser.id });
      const ids = plan.operations.followUps.map((f) => f.followUpId).sort();
      expect(ids).toEqual([done.id, pending.id, snoozed.id].sort());
      expect(plan.operations.followUps.find((f) => f.followUpId === done.id)?.status).toBe("DONE");
      expect(plan.operations.followUps.find((f) => f.followUpId === snoozed.id)?.status).toBe("SNOOZED");
    } finally {
      await db!.followUp.deleteMany({ where: { leadId: loser.id } });
      await db!.lead.deleteMany({ where: { id: { in: [survivor.id, loser.id] } } });
    }
  });

  it("outcomes reachable through the loser's conversations are listed, correctly attributed to the loser -> survivor re-parent", async () => {
    const survivor = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Real Name", phone: "+51900000011" } });
    const loser = await db!.lead.create({ data: { businessId: fixture.businessId, name: "51900000011", phone: "51900000011" } });

    const loserConv = await db!.conversation.create({
      data: {
        businessId: fixture.businessId,
        leadId: loser.id,
        source: "MANUAL_PASTE",
        lastEntryAt: new Date(),
        lastEntryDirection: "INBOUND",
        createdByUserId: fixture.userId,
      },
    });
    const decisionRecordId = await createDecisionRecordFixture(db!, { businessId: fixture.businessId, userId: fixture.userId, leadId: loser.id, conversationId: loserConv.id });
    const outcome = await db!.outcome.create({ data: { decisionRecordId, outcomeType: "SALE_CLOSED" } });

    try {
      const plan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: survivor.id, loserLeadId: loser.id });
      expect(plan.operations.outcomes).toHaveLength(1);
      expect(plan.operations.outcomes[0]).toMatchObject({
        outcomeId: outcome.id,
        decisionRecordId,
        viaConversationId: loserConv.id,
        fromLeadId: loser.id,
        toLeadId: survivor.id,
        outcomeType: "SALE_CLOSED",
      });
    } finally {
      await db!.outcome.delete({ where: { id: outcome.id } });
      await db!.decisionRecord.delete({ where: { id: decisionRecordId } });
      await db!.conversation.delete({ where: { id: loserConv.id } });
      await db!.lead.deleteMany({ where: { id: { in: [survivor.id, loser.id] } } });
    }
  });

  it("commercial-profile collision (both leads have a profile) is flagged MANUAL_REVIEW, never silently resolved", async () => {
    const survivor = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Real Name", phone: "+51900000012" } });
    const loser = await db!.lead.create({ data: { businessId: fixture.businessId, name: "51900000012", phone: "51900000012" } });
    await db!.leadCommercialProfile.create({ data: { leadId: survivor.id, businessId: fixture.businessId, vehicleBrand: "Toyota" } });
    await db!.leadCommercialProfile.create({ data: { leadId: loser.id, businessId: fixture.businessId, vehicleBrand: "Ford" } });

    try {
      const plan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: survivor.id, loserLeadId: loser.id });
      expect(plan.executable).toBe(false);
      expect(plan.blockers.map((b) => b.reason)).toContain("COMMERCIAL_PROFILE_COLLISION");
      expect(plan.operations.commercialProfile.action).toBe("MANUAL_REVIEW_COLLISION");
      expect(plan.operations.commercialProfile.survivorProfile?.vehicleBrand).toBe("Toyota");
      expect(plan.operations.commercialProfile.loserProfile?.vehicleBrand).toBe("Ford");
      // The rest of the plan is still fully computed — a blocker doesn't hide other information.
      expect(plan.operations.name.action).toBe("KEEP_SURVIVOR_NAME");
    } finally {
      await db!.leadCommercialProfile.deleteMany({ where: { leadId: { in: [survivor.id, loser.id] } } });
      await db!.lead.deleteMany({ where: { id: { in: [survivor.id, loser.id] } } });
    }
  });

  it("different assigned agents is flagged MANUAL_REVIEW, never chosen automatically", async () => {
    const otherAgent = await db!.user.create({ data: { email: `other-agent-${Date.now()}@example.com`, name: "Other Agent", role: "SALESPERSON", businessId: fixture.businessId } });
    const survivor = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Real Name", phone: "+51900000013", assignedToUserId: fixture.userId } });
    const loser = await db!.lead.create({ data: { businessId: fixture.businessId, name: "51900000013", phone: "51900000013", assignedToUserId: otherAgent.id } });

    try {
      const plan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: survivor.id, loserLeadId: loser.id });
      expect(plan.executable).toBe(false);
      expect(plan.blockers.map((b) => b.reason)).toContain("ASSIGNED_AGENT_MISMATCH");
      expect(plan.operations.assignment.action).toBe("MANUAL_REVIEW_MISMATCH");
      expect(plan.operations.assignment.survivorAssignedAgentId).toBe(fixture.userId);
      expect(plan.operations.assignment.loserAssignedAgentId).toBe(otherAgent.id);
    } finally {
      await db!.lead.deleteMany({ where: { id: { in: [survivor.id, loser.id] } } });
      await db!.user.delete({ where: { id: otherAgent.id } });
    }
  });

  it("both leads unassigned (the real production case) is NOT flagged as a mismatch", async () => {
    const survivor = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Real Name", phone: "+51900000014" } });
    const loser = await db!.lead.create({ data: { businessId: fixture.businessId, name: "51900000014", phone: "51900000014" } });

    try {
      const plan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: survivor.id, loserLeadId: loser.id });
      expect(plan.executable).toBe(true);
      expect(plan.operations.assignment.action).toBe("KEEP_SURVIVOR_ASSIGNMENT");
    } finally {
      await db!.lead.deleteMany({ where: { id: { in: [survivor.id, loser.id] } } });
    }
  });

  it("rejects a cross-business pair — never merges leads from two different tenants", async () => {
    const other = await createTestFixture(db!, "merge-plan-other");
    const survivor = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Mine", phone: "+51900000015" } });
    const loser = await db!.lead.create({ data: { businessId: other.businessId, name: "Theirs", phone: "51900000015" } });

    try {
      const plan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: survivor.id, loserLeadId: loser.id });
      expect(plan.executable).toBe(false);
      expect(plan.blockers.map((b) => b.reason)).toContain("CROSS_BUSINESS");
      expect(plan.operations.conversations).toEqual([]); // full plan not computed once cross-business is detected
    } finally {
      await db!.lead.deleteMany({ where: { id: { in: [survivor.id, loser.id] } } });
      await cleanupTestFixture(db!, other);
    }
  });

  it("rejects a pair whose phones normalize to different real numbers — this is not actually a duplicate", async () => {
    const survivor = await db!.lead.create({ data: { businessId: fixture.businessId, name: "A", phone: "+51900000016" } });
    const loser = await db!.lead.create({ data: { businessId: fixture.businessId, name: "B", phone: "+51900000017" } });

    try {
      const plan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: survivor.id, loserLeadId: loser.id });
      expect(plan.executable).toBe(false);
      expect(plan.blockers.map((b) => b.reason)).toContain("PHONE_MISMATCH");
      expect(plan.normalizedPhone).toBeNull();
    } finally {
      await db!.lead.deleteMany({ where: { id: { in: [survivor.id, loser.id] } } });
    }
  });

  it("rejects when the loser lead does not exist", async () => {
    const survivor = await db!.lead.create({ data: { businessId: fixture.businessId, name: "A", phone: "+51900000018" } });
    try {
      const plan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: survivor.id, loserLeadId: "00000000-0000-0000-0000-000000000000" });
      expect(plan.executable).toBe(false);
      expect(plan.blockers.map((b) => b.reason)).toContain("LEAD_NOT_FOUND");
    } finally {
      await db!.lead.delete({ where: { id: survivor.id } });
    }
  });

  it("rejects when survivorLeadId === loserLeadId", async () => {
    const lead = await db!.lead.create({ data: { businessId: fixture.businessId, name: "A", phone: "+51900000019" } });
    try {
      const plan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: lead.id, loserLeadId: lead.id });
      expect(plan.executable).toBe(false);
      expect(plan.blockers.map((b) => b.reason)).toContain("SAME_LEAD");
    } finally {
      await db!.lead.delete({ where: { id: lead.id } });
    }
  });

  it("is provably read-only — never calls a write method on any touched model, for both the executable and blocked paths", async () => {
    const survivor = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Real Name", phone: "+51900000020" } });
    const loser = await db!.lead.create({ data: { businessId: fixture.businessId, name: "51900000020", phone: "51900000020" } });

    const models = [db!.lead, db!.conversation, db!.followUp, db!.outcome, db!.leadCommercialProfile, db!.decisionRecord] as const;
    const methods = ["create", "update", "delete", "upsert", "createMany", "updateMany", "deleteMany"] as const;
    const spies = models.flatMap((model) => methods.map((method) => vi.spyOn(model, method)));
    const rawSpy = vi.spyOn(db!, "$queryRaw");
    const execSpy = vi.spyOn(db!, "$executeRaw");

    try {
      await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: survivor.id, loserLeadId: loser.id });
      // A cross-business/missing-lead rejection path too, in the same spy scope.
      await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: survivor.id, loserLeadId: "00000000-0000-0000-0000-000000000000" });

      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(rawSpy).not.toHaveBeenCalled();
      expect(execSpy).not.toHaveBeenCalled();
    } finally {
      spies.forEach((s) => s.mockRestore());
      rawSpy.mockRestore();
      execSpy.mockRestore();
      await db!.lead.deleteMany({ where: { id: { in: [survivor.id, loser.id] } } });
    }
  });
});
