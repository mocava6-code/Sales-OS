// Gated: proves executeLeadMerge (Kori Legacy Data Remediation v0, Merge
// Executor v0 — DRY_RUN ONLY) against real Postgres (sales_os_test).
// Covers the exact production shape, every drift-detection path (stale
// counts, disappeared IDs, new blockers appearing after approval), the
// ordered write preview, idempotency, and — critically — that this module
// never writes anything, ever, under any circumstance.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { planLeadMerge } from "../merge-remediation-plan";
import { executeLeadMerge } from "../execute-lead-merge";
import { cleanupTestFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "../../../persistence/__tests__/test-db";

describe.skipIf(!shouldRunDbTests)("executeLeadMerge (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "execute-merge");
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
  });

  /**
   * Mirrors the real production shape for +51933517901: the survivor's
   * OWN stored phone is the non-canonical, no-leading-"+" WhatsApp-digits
   * format (so the phone-normalize write step is non-trivial, exactly
   * like production's actual survivor 9b64e8a2), its name is still the
   * unedited phone-placeholder, and it has a commercial profile plus one
   * live NEEDS_REPLY conversation. The loser is already canonically
   * "+"-prefixed, has a non-placeholder (but not trustworthy — see the
   * survivor-ranking doc) name, no profile, and 2 older conversations
   * plus 1 follow-up.
   */
  async function buildProductionShapePair(nationalSuffix: string) {
    const national = `900000${nationalSuffix}`; // 9 digits total, valid Peru mobile shape
    const survivorPhone = `51${national}`; // no leading "+" — WhatsApp-digits format
    const loserPhone = `+51${national}`; // already canonical

    const survivor = await db!.lead.create({ data: { businessId: fixture.businessId, name: survivorPhone, phone: survivorPhone } });
    const loser = await db!.lead.create({ data: { businessId: fixture.businessId, name: "prueba", phone: loserPhone } });
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

    return { survivor, loser, survivorConv, loserConv1, loserConv2, loserFollowUp, survivorPhone, loserPhone, canonicalPhone: loserPhone };
  }

  async function cleanupPair(p: { survivor: { id: string }; loser: { id: string }; survivorConv: { id: string }; loserConv1: { id: string }; loserConv2: { id: string } }) {
    await db!.followUp.deleteMany({ where: { leadId: { in: [p.survivor.id, p.loser.id] } } });
    await db!.conversation.deleteMany({ where: { id: { in: [p.survivorConv.id, p.loserConv1.id, p.loserConv2.id] } } });
    await db!.leadCommercialProfile.deleteMany({ where: { leadId: { in: [p.survivor.id, p.loser.id] } } });
    await db!.lead.deleteMany({ where: { id: { in: [p.survivor.id, p.loser.id] } } });
  }

  it("1. exact production-shape dry-run returns executable=true, with a complete ordered write preview", async () => {
    const p = await buildProductionShapePair("001");
    try {
      const approvedPlan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id });
      const preview = await executeLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, mode: "DRY_RUN", approvedPlan });

      expect(preview.mode).toBe("DRY_RUN");
      expect(preview.executable).toBe(true);
      expect(preview.blockReasons).toEqual([]);
      expect(preview.preconditionResults.every((pc) => pc.status === "OK")).toBe(true);

      expect(preview.writePreview.map((w) => w.step)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);

      const conversationStep = preview.writePreview.find((w) => w.step === 2)!;
      expect(conversationStep.operation).toMatchObject({ model: "conversation", method: "updateMany", args: { data: { leadId: p.survivor.id } } });
      expect((conversationStep.operation!.args.where as { id: { in: string[] } }).id.in.sort()).toEqual([p.loserConv1.id, p.loserConv2.id].sort());

      const followUpStep = preview.writePreview.find((w) => w.step === 3)!;
      expect(followUpStep.operation).toMatchObject({ model: "followUp", method: "updateMany", args: { where: { id: { in: [p.loserFollowUp.id] } }, data: { leadId: p.survivor.id } } });

      const profileStep = preview.writePreview.find((w) => w.step === 4)!;
      expect(profileStep.operation).toBeNull(); // KEEP_SURVIVOR — no write

      const nameAssignmentStep = preview.writePreview.find((w) => w.step === 5)!;
      expect(nameAssignmentStep.operation).toBeNull();

      // The survivor's own stored phone ("51900000001", no "+") is NOT
      // yet canonical — this is the one write step that must be non-null.
      const phoneStep = preview.writePreview.find((w) => w.step === 6)!;
      expect(phoneStep.operation).toMatchObject({ model: "lead", method: "update", args: { where: { id: p.survivor.id }, data: { phone: p.canonicalPhone } } });

      const verifyStep = preview.writePreview.find((w) => w.step === 7)!;
      expect(verifyStep.operation).toBeNull();

      const deleteStep = preview.writePreview.find((w) => w.step === 8)!;
      expect(deleteStep.operation).toMatchObject({ model: "lead", method: "delete", args: { where: { id: p.loser.id } } });

      const finalVerifyStep = preview.writePreview.find((w) => w.step === 9)!;
      expect(finalVerifyStep.operation).toBeNull();

      expect(preview.plan.cardinality).toEqual({
        before: { survivorConversationCount: 1, loserConversationCount: 2, survivorFollowUpCount: 0, loserFollowUpCount: 1, survivorOutcomeCount: 0, loserOutcomeCount: 0 },
        expectedAfter: { survivorConversationCount: 3, survivorFollowUpCount: 1, preservedOutcomeCount: 0, loserConversationCount: 0, loserFollowUpCount: 0, loserOutcomeCount: 0 },
      });
    } finally {
      await cleanupPair(p);
    }
  });

  it("2. stale child count (loser gained a conversation after approval) -> executable=false", async () => {
    const p = await buildProductionShapePair("002");
    try {
      const approvedPlan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id });

      const extraConv = await db!.conversation.create({
        data: {
          businessId: fixture.businessId,
          leadId: p.loser.id,
          source: "MANUAL_PASTE",
          lastEntryAt: new Date(),
          lastEntryDirection: "INBOUND",
          createdByUserId: fixture.userId,
        },
      });

      try {
        const preview = await executeLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, mode: "DRY_RUN", approvedPlan });
        expect(preview.executable).toBe(false);
        expect(preview.blockReasons).toContain("CHILD_COUNTS_DRIFTED");
        expect(preview.preconditionResults.find((pc) => pc.key === "CHILD_COUNTS_MATCH_APPROVED_SNAPSHOT")?.status).toBe("FAILED");
      } finally {
        await db!.conversation.delete({ where: { id: extraConv.id } });
      }
    } finally {
      await cleanupPair(p);
    }
  });

  it("3. a planned conversation ID disappeared after approval -> executable=false", async () => {
    const p = await buildProductionShapePair("003");
    try {
      const approvedPlan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id });
      await db!.conversation.delete({ where: { id: p.loserConv1.id } }); // simulate it vanishing between approval and execution

      const preview = await executeLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, mode: "DRY_RUN", approvedPlan });
      expect(preview.executable).toBe(false);
      expect(preview.blockReasons).toContain("CONVERSATION_ID_MISSING");
      expect(preview.preconditionResults.find((pc) => pc.key === "PLANNED_CONVERSATION_IDS_STILL_EXIST")?.status).toBe("FAILED");
    } finally {
      // loserConv1 already deleted above — only loserConv2/survivorConv remain to clean up.
      await db!.followUp.deleteMany({ where: { leadId: { in: [p.survivor.id, p.loser.id] } } });
      await db!.conversation.deleteMany({ where: { id: { in: [p.survivorConv.id, p.loserConv2.id] } } });
      await db!.leadCommercialProfile.deleteMany({ where: { leadId: { in: [p.survivor.id, p.loser.id] } } });
      await db!.lead.deleteMany({ where: { id: { in: [p.survivor.id, p.loser.id] } } });
    }
  });

  it("4. a planned follow-up ID disappeared after approval -> executable=false", async () => {
    const p = await buildProductionShapePair("004");
    try {
      const approvedPlan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id });
      await db!.followUp.delete({ where: { id: p.loserFollowUp.id } });

      const preview = await executeLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, mode: "DRY_RUN", approvedPlan });
      expect(preview.executable).toBe(false);
      expect(preview.blockReasons).toContain("FOLLOW_UP_ID_MISSING");
      expect(preview.preconditionResults.find((pc) => pc.key === "PLANNED_FOLLOW_UP_IDS_STILL_EXIST")?.status).toBe("FAILED");
    } finally {
      await cleanupPair(p);
    }
  });

  it("5. phone mismatch after approval -> executable=false", async () => {
    const p = await buildProductionShapePair("005");
    try {
      const approvedPlan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id });
      await db!.lead.update({ where: { id: p.loser.id }, data: { phone: "+51900099999" } }); // no longer the same real number

      const preview = await executeLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, mode: "DRY_RUN", approvedPlan });
      expect(preview.executable).toBe(false);
      expect(preview.plan.blockers.map((b) => b.reason)).toContain("PHONE_MISMATCH");
      expect(preview.blockReasons).toContain("PLAN_NOT_EXECUTABLE");
    } finally {
      await cleanupPair(p);
    }
  });

  it("6. cross-business after approval -> executable=false", async () => {
    const p = await buildProductionShapePair("006");
    const other = await createTestFixture(db!, "execute-merge-other");
    try {
      const approvedPlan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id });
      await db!.lead.update({ where: { id: p.loser.id }, data: { businessId: other.businessId } });

      const preview = await executeLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, mode: "DRY_RUN", approvedPlan });
      expect(preview.executable).toBe(false);
      expect(preview.plan.blockers.map((b) => b.reason)).toContain("CROSS_BUSINESS");
    } finally {
      await db!.lead.update({ where: { id: p.loser.id }, data: { businessId: fixture.businessId } }); // restore before shared cleanup
      await cleanupPair(p);
      await cleanupTestFixture(db!, other);
    }
  });

  it("7. commercial-profile collision appearing after approval -> executable=false", async () => {
    const p = await buildProductionShapePair("007");
    try {
      const approvedPlan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id });
      expect(approvedPlan.executable).toBe(true); // sanity: valid at approval time

      await db!.leadCommercialProfile.create({ data: { leadId: p.loser.id, businessId: fixture.businessId, vehicleBrand: "Ford" } });

      const preview = await executeLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, mode: "DRY_RUN", approvedPlan });
      expect(preview.executable).toBe(false);
      expect(preview.plan.blockers.map((b) => b.reason)).toContain("COMMERCIAL_PROFILE_COLLISION");
    } finally {
      await cleanupPair(p);
    }
  });

  it("8. assignment mismatch appearing after approval -> executable=false", async () => {
    const p = await buildProductionShapePair("008");
    const otherAgent = await db!.user.create({ data: { email: `other-agent-${Date.now()}@example.com`, name: "Other Agent", role: "SALESPERSON", businessId: fixture.businessId } });
    try {
      const approvedPlan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id });
      await db!.lead.update({ where: { id: p.loser.id }, data: { assignedToUserId: otherAgent.id } });

      const preview = await executeLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, mode: "DRY_RUN", approvedPlan });
      expect(preview.executable).toBe(false);
      expect(preview.plan.blockers.map((b) => b.reason)).toContain("ASSIGNED_AGENT_MISMATCH");
    } finally {
      await cleanupPair(p);
      await db!.user.delete({ where: { id: otherAgent.id } });
    }
  });

  it("9. never calls a Prisma write method, across executable and every blocked scenario", async () => {
    const p = await buildProductionShapePair("009");
    try {
      const approvedPlan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id });

      const models = [db!.lead, db!.conversation, db!.followUp, db!.outcome, db!.leadCommercialProfile, db!.decisionRecord] as const;
      const methods = ["create", "update", "delete", "upsert", "createMany", "updateMany", "deleteMany"] as const;
      const spies = models.flatMap((model) => methods.map((method) => vi.spyOn(model, method)));
      const rawSpy = vi.spyOn(db!, "$queryRaw");
      const execSpy = vi.spyOn(db!, "$executeRaw");

      try {
        // Executable path.
        await executeLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, mode: "DRY_RUN", approvedPlan });
        // A mismatched-approval-ids path too, same spy scope.
        await executeLeadMerge(db!, {
          businessId: fixture.businessId,
          survivorLeadId: p.survivor.id,
          loserLeadId: p.loser.id,
          mode: "DRY_RUN",
          approvedPlan: { ...approvedPlan, loserLeadId: "00000000-0000-0000-0000-000000000000" },
        });

        for (const spy of spies) expect(spy).not.toHaveBeenCalled();
        expect(rawSpy).not.toHaveBeenCalled();
        expect(execSpy).not.toHaveBeenCalled();
      } finally {
        spies.forEach((s) => s.mockRestore());
        rawSpy.mockRestore();
        execSpy.mockRestore();
      }
    } finally {
      await cleanupPair(p);
    }
  });

  it("10. ordered write preview exactly matches transactionOrder's numbered steps", async () => {
    const p = await buildProductionShapePair("010");
    try {
      const approvedPlan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id });
      const preview = await executeLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, mode: "DRY_RUN", approvedPlan });

      for (const step of preview.writePreview) {
        expect(preview.plan.transactionOrder[step.step - 1]).toMatch(new RegExp(`^${step.step}\\. `));
      }
      expect(preview.plan.transactionOrder[preview.writePreview.find((s) => s.step === 2)!.step - 1]).toContain("Reparent loser conversations");
      expect(preview.plan.transactionOrder[preview.writePreview.find((s) => s.step === 8)!.step - 1]).toContain("Delete the loser Lead");
    } finally {
      await cleanupPair(p);
    }
  });

  it("11. dry-run is idempotent — calling it repeatedly with the same approved plan and unchanged live state produces the same result", async () => {
    const p = await buildProductionShapePair("011");
    try {
      const approvedPlan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id });
      const first = await executeLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, mode: "DRY_RUN", approvedPlan });
      const second = await executeLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, mode: "DRY_RUN", approvedPlan });

      expect(second.executable).toBe(first.executable);
      expect(second.blockReasons).toEqual(first.blockReasons);
      expect(second.writePreview).toEqual(first.writePreview);
      expect(second.preconditionResults).toEqual(first.preconditionResults);
    } finally {
      await cleanupPair(p);
    }
  });

  it("12. the known-pair simulation is completely untouched after a dry-run — same leads, same phones, same parenting", async () => {
    const p = await buildProductionShapePair("012");
    try {
      const approvedPlan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id });
      await executeLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, mode: "DRY_RUN", approvedPlan });

      const stillTwoLeads = await db!.lead.findMany({ where: { id: { in: [p.survivor.id, p.loser.id] } } });
      expect(stillTwoLeads).toHaveLength(2);
      expect(stillTwoLeads.find((l) => l.id === p.survivor.id)?.phone).toBe(p.survivorPhone);
      expect(stillTwoLeads.find((l) => l.id === p.loser.id)?.phone).toBe(p.loserPhone);

      const loserConversationsStillOnLoser = await db!.conversation.findMany({ where: { id: { in: [p.loserConv1.id, p.loserConv2.id] } } });
      expect(loserConversationsStillOnLoser.every((c) => c.leadId === p.loser.id)).toBe(true);
      const survivorConvStillOnSurvivor = await db!.conversation.findUnique({ where: { id: p.survivorConv.id } });
      expect(survivorConvStillOnSurvivor?.leadId).toBe(p.survivor.id);
      const followUpStillOnLoser = await db!.followUp.findUnique({ where: { id: p.loserFollowUp.id } });
      expect(followUpStillOnLoser?.leadId).toBe(p.loser.id);
      const profileStillOnSurvivor = await db!.leadCommercialProfile.findUnique({ where: { leadId: p.survivor.id } });
      expect(profileStillOnSurvivor).not.toBeNull();
    } finally {
      await cleanupPair(p);
    }
  });
});
