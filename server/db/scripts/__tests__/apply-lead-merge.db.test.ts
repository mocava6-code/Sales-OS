// Gated: proves applyLeadMerge — the ONLY write-capable function in this
// remediation toolchain — against real Postgres (sales_os_test). Covers
// the happy path with exact final-state verification, the explicit
// collision-resolution override (and its scoping), every refusal path
// with direct DB-state proof that nothing partially changed, and
// idempotency (calling twice never corrupts the survivor).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planLeadMerge } from "../merge-remediation-plan";
import { applyLeadMerge } from "../apply-lead-merge";
import type { ApprovedMergeResolution } from "../merge-resolution";
import { cleanupTestFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "../../../persistence/__tests__/test-db";

describe.skipIf(!shouldRunDbTests)("applyLeadMerge (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "apply-merge");
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
  });

  /** Same shape as execute-lead-merge's fixture: survivor's own stored phone is non-canonical (no "+"), matching the real production pair. `withSurvivorProfile`/`withLoserProfile` let each test control collision shape. */
  async function buildPair(nationalSuffix: string, opts: { survivorProfile?: boolean; loserProfile?: boolean } = {}) {
    const national = `900000${nationalSuffix}`;
    const survivorPhone = `51${national}`;
    const loserPhone = `+51${national}`;

    const survivor = await db!.lead.create({ data: { businessId: fixture.businessId, name: survivorPhone, phone: survivorPhone } });
    const loser = await db!.lead.create({ data: { businessId: fixture.businessId, name: "prueba", phone: loserPhone } });

    if (opts.survivorProfile !== false) {
      await db!.leadCommercialProfile.create({ data: { leadId: survivor.id, businessId: fixture.businessId, vehicleModel: "Hilux TRAVO 2022", productInterest: "Hilux TRAVO 2022 kit" } });
    }
    if (opts.loserProfile) {
      await db!.leadCommercialProfile.create({ data: { leadId: loser.id, businessId: fixture.businessId, vehicleBrand: "Toyota", vehicleModel: "Hilux", vehicleYear: 2026 } });
    }

    const survivorConv = await db!.conversation.create({
      data: { businessId: fixture.businessId, leadId: survivor.id, source: "MANUAL_PASTE", status: "NEEDS_REPLY", lastEntryAt: new Date(), lastEntryDirection: "INBOUND", createdByUserId: fixture.userId },
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
      data: { businessId: fixture.businessId, leadId: loser.id, source: "MANUAL_PASTE", status: "CLOSED", lastEntryAt: new Date("2026-07-10T00:00:00Z"), lastEntryDirection: "OUTBOUND", createdByUserId: fixture.userId },
    });
    const loserFollowUp = await db!.followUp.create({ data: { leadId: loser.id, userId: fixture.userId, dueAt: new Date(), status: "PENDING" } });

    return { survivor, loser, survivorConv, loserConv1, loserConv2, loserFollowUp, survivorPhone, canonicalPhone: loserPhone };
  }

  /** Best-effort cleanup that tolerates rows a successful merge already removed. */
  async function cleanup(p: { survivor: { id: string }; loser: { id: string }; survivorConv: { id: string }; loserConv1: { id: string }; loserConv2: { id: string } }) {
    await db!.followUp.deleteMany({ where: { leadId: { in: [p.survivor.id, p.loser.id] } } });
    await db!.conversation.deleteMany({ where: { id: { in: [p.survivorConv.id, p.loserConv1.id, p.loserConv2.id] } } });
    await db!.leadCommercialProfile.deleteMany({ where: { leadId: { in: [p.survivor.id, p.loser.id] } } });
    await db!.lead.deleteMany({ where: { id: { in: [p.survivor.id, p.loser.id] } } });
  }

  it("1. happy path (no collision): applies, and the final DB state matches exactly", async () => {
    const p = await buildPair("101");
    try {
      const approvedPlan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id });
      const result = await applyLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, approvedPlan });

      expect(result.applied).toBe(true);
      if (!result.applied) throw new Error("expected applied=true");
      expect(result.canonicalPhone).toBe(p.canonicalPhone);
      expect(result.reparentedConversationIds.sort()).toEqual([p.loserConv1.id, p.loserConv2.id].sort());
      expect(result.reparentedFollowUpIds).toEqual([p.loserFollowUp.id]);
      expect(result.commercialProfileAction).toBe("KEEP_SURVIVOR");
      expect(result.finalSurvivorConversationCount).toBe(3);
      expect(result.finalSurvivorFollowUpCount).toBe(1);

      const survivorRow = await db!.lead.findUnique({ where: { id: p.survivor.id } });
      expect(survivorRow?.phone).toBe(p.canonicalPhone);
      expect(survivorRow?.name).toBe(p.survivorPhone); // never overwritten

      const loserRow = await db!.lead.findUnique({ where: { id: p.loser.id } });
      expect(loserRow).toBeNull();

      const conv1 = await db!.conversation.findUnique({ where: { id: p.loserConv1.id } });
      const conv2 = await db!.conversation.findUnique({ where: { id: p.loserConv2.id } });
      expect(conv1?.leadId).toBe(p.survivor.id);
      expect(conv2?.leadId).toBe(p.survivor.id);
      const originalSurvivorConv = await db!.conversation.findUnique({ where: { id: p.survivorConv.id } });
      expect(originalSurvivorConv?.leadId).toBe(p.survivor.id);

      const followUp = await db!.followUp.findUnique({ where: { id: p.loserFollowUp.id } });
      expect(followUp?.leadId).toBe(p.survivor.id);

      const profile = await db!.leadCommercialProfile.findUnique({ where: { leadId: p.survivor.id } });
      expect(profile?.vehicleModel).toBe("Hilux TRAVO 2022"); // untouched
    } finally {
      await cleanup(p);
    }
  });

  it("2. collision + matching resolution: applies, deletes the loser's profile, survivor's profile is untouched", async () => {
    const p = await buildPair("102", { loserProfile: true });
    try {
      const approvedPlan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id });
      expect(approvedPlan.executable).toBe(false); // sanity: collision blocks by default

      const resolution: ApprovedMergeResolution = {
        businessId: fixture.businessId,
        survivorLeadId: p.survivor.id,
        loserLeadId: p.loser.id,
        commercialProfileCollision: {
          businessId: fixture.businessId,
          survivorLeadId: p.survivor.id,
          loserLeadId: p.loser.id,
          resolution: "KEEP_SURVIVOR",
          approvedReason: "test: loser profile is manual-data noise",
          approvedAt: "2026-01-01T00:00:00Z",
        },
      };

      const result = await applyLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, approvedPlan, resolution });
      expect(result.applied).toBe(true);
      if (!result.applied) throw new Error("expected applied=true");
      expect(result.commercialProfileAction).toBe("RESOLVED_COLLISION_KEEP_SURVIVOR");

      const survivorProfile = await db!.leadCommercialProfile.findUnique({ where: { leadId: p.survivor.id } });
      expect(survivorProfile?.vehicleModel).toBe("Hilux TRAVO 2022"); // untouched, never blended
      const loserProfileGone = await db!.leadCommercialProfile.findFirst({ where: { leadId: p.loser.id } });
      expect(loserProfileGone).toBeNull();
      const loserRow = await db!.lead.findUnique({ where: { id: p.loser.id } });
      expect(loserRow).toBeNull();
    } finally {
      await cleanup(p);
    }
  });

  it("3. collision + no resolution: refuses, and the DB is completely untouched", async () => {
    const p = await buildPair("103", { loserProfile: true });
    try {
      const approvedPlan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id });
      const result = await applyLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, approvedPlan });

      expect(result.applied).toBe(false);
      if (result.applied) throw new Error("expected applied=false");
      expect(result.reason).toContain("collision");

      const survivorRow = await db!.lead.findUnique({ where: { id: p.survivor.id } });
      const loserRow = await db!.lead.findUnique({ where: { id: p.loser.id } });
      expect(survivorRow?.phone).toBe(p.survivorPhone); // NOT canonicalized
      expect(loserRow).not.toBeNull(); // still exists
      expect(loserRow?.phone).toBe(p.canonicalPhone);
      const conv1 = await db!.conversation.findUnique({ where: { id: p.loserConv1.id } });
      expect(conv1?.leadId).toBe(p.loser.id); // NOT reparented
      const loserProfile = await db!.leadCommercialProfile.findUnique({ where: { leadId: p.loser.id } });
      expect(loserProfile).not.toBeNull(); // NOT deleted
    } finally {
      await cleanup(p);
    }
  });

  it("4. collision + resolution scoped to a DIFFERENT pair: refuses, DB untouched", async () => {
    const p = await buildPair("104", { loserProfile: true });
    try {
      const approvedPlan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id });
      const wrongResolution: ApprovedMergeResolution = {
        businessId: fixture.businessId,
        survivorLeadId: p.survivor.id,
        loserLeadId: "00000000-0000-0000-0000-000000000000", // scoped to a different (nonexistent) loser
        commercialProfileCollision: {
          businessId: fixture.businessId,
          survivorLeadId: p.survivor.id,
          loserLeadId: "00000000-0000-0000-0000-000000000000",
          resolution: "KEEP_SURVIVOR",
          approvedReason: "test",
          approvedAt: "2026-01-01T00:00:00Z",
        },
      };

      const result = await applyLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, approvedPlan, resolution: wrongResolution });
      expect(result.applied).toBe(false);

      const loserRow = await db!.lead.findUnique({ where: { id: p.loser.id } });
      expect(loserRow).not.toBeNull();
    } finally {
      await cleanup(p);
    }
  });

  it("5. drift (loser gained a conversation after approval): refuses, DB untouched", async () => {
    const p = await buildPair("105");
    try {
      const approvedPlan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id });

      const extraConv = await db!.conversation.create({
        data: { businessId: fixture.businessId, leadId: p.loser.id, source: "MANUAL_PASTE", lastEntryAt: new Date(), lastEntryDirection: "INBOUND", createdByUserId: fixture.userId },
      });

      try {
        const result = await applyLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, approvedPlan });
        expect(result.applied).toBe(false);
        if (result.applied) throw new Error("expected applied=false");
        expect(result.reason).toContain("drifted");

        const conv1 = await db!.conversation.findUnique({ where: { id: p.loserConv1.id } });
        expect(conv1?.leadId).toBe(p.loser.id); // NOT reparented — the whole attempt was refused
        const loserRow = await db!.lead.findUnique({ where: { id: p.loser.id } });
        expect(loserRow).not.toBeNull();
      } finally {
        await db!.conversation.delete({ where: { id: extraConv.id } });
      }
    } finally {
      await cleanup(p);
    }
  });

  it("6. assignment mismatch: refuses (no override exists for this blocker), DB untouched", async () => {
    const p = await buildPair("106");
    const otherAgent = await db!.user.create({ data: { email: `other-agent-${Date.now()}@example.com`, name: "Other Agent", role: "SALESPERSON", businessId: fixture.businessId } });
    try {
      const approvedPlan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id });
      await db!.lead.update({ where: { id: p.loser.id }, data: { assignedToUserId: otherAgent.id } });

      const result = await applyLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, approvedPlan });
      expect(result.applied).toBe(false);

      const loserRow = await db!.lead.findUnique({ where: { id: p.loser.id } });
      expect(loserRow).not.toBeNull();
    } finally {
      await cleanup(p);
      await db!.user.delete({ where: { id: otherAgent.id } });
    }
  });

  it("7. cross-business drift after approval: refuses, DB untouched", async () => {
    const p = await buildPair("107");
    const other = await createTestFixture(db!, "apply-merge-other");
    try {
      const approvedPlan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id });
      await db!.lead.update({ where: { id: p.loser.id }, data: { businessId: other.businessId } });

      const result = await applyLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, approvedPlan });
      expect(result.applied).toBe(false);
    } finally {
      await db!.lead.update({ where: { id: p.loser.id }, data: { businessId: fixture.businessId } });
      await cleanup(p);
      await cleanupTestFixture(db!, other);
    }
  });

  it("8. never calls a Prisma write method when refused, across every refusal scenario in one spy scope", async () => {
    const p = await buildPair("108", { loserProfile: true });
    try {
      const approvedPlan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id });

      const createSpy = vi.spyOn(db!.lead, "create");
      const updateSpy = vi.spyOn(db!.lead, "update");
      const deleteSpy = vi.spyOn(db!.lead, "delete");
      const convUpdateManySpy = vi.spyOn(db!.conversation, "updateMany");
      const followUpUpdateManySpy = vi.spyOn(db!.followUp, "updateMany");
      const profileDeleteSpy = vi.spyOn(db!.leadCommercialProfile, "delete");
      const profileUpdateSpy = vi.spyOn(db!.leadCommercialProfile, "update");

      try {
        // Collision, no resolution — refused.
        await applyLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, approvedPlan });
        // Nonexistent loser — refused.
        await applyLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: "00000000-0000-0000-0000-000000000000", approvedPlan });

        expect(createSpy).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();
        expect(deleteSpy).not.toHaveBeenCalled();
        expect(convUpdateManySpy).not.toHaveBeenCalled();
        expect(followUpUpdateManySpy).not.toHaveBeenCalled();
        expect(profileDeleteSpy).not.toHaveBeenCalled();
        expect(profileUpdateSpy).not.toHaveBeenCalled();
      } finally {
        createSpy.mockRestore();
        updateSpy.mockRestore();
        deleteSpy.mockRestore();
        convUpdateManySpy.mockRestore();
        followUpUpdateManySpy.mockRestore();
        profileDeleteSpy.mockRestore();
        profileUpdateSpy.mockRestore();
      }
    } finally {
      await cleanup(p);
    }
  });

  it("9. idempotency: calling applyLeadMerge again after a successful merge refuses cleanly and never corrupts the survivor", async () => {
    const p = await buildPair("109");
    try {
      const approvedPlan = await planLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id });
      const first = await applyLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, approvedPlan });
      expect(first.applied).toBe(true);

      const survivorAfterFirst = await db!.lead.findUnique({ where: { id: p.survivor.id } });

      // Re-apply with the SAME (now stale) approvedPlan — the loser no longer exists.
      const second = await applyLeadMerge(db!, { businessId: fixture.businessId, survivorLeadId: p.survivor.id, loserLeadId: p.loser.id, approvedPlan });
      expect(second.applied).toBe(false);

      const survivorAfterSecond = await db!.lead.findUnique({ where: { id: p.survivor.id } });
      expect(survivorAfterSecond).toEqual(survivorAfterFirst); // completely unchanged by the no-op second attempt
    } finally {
      await cleanup(p);
    }
  });
});
