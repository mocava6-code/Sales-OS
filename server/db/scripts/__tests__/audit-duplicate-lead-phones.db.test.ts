// Gated: proves auditDuplicateLeadPhones (Kori Legacy Data Remediation v0,
// Phase A) against real Postgres (sales_os_test) — grouping by normalized
// E.164, tenant isolation, unparseable-phone handling, every reported
// per-lead field (status/priority/conversations/follow-ups/outcomes/
// commercial profile), the Phase B survivor recommendation attached to
// each group, and — critically — that this script never writes anything.
// Imports auditDuplicateLeadPhones directly, never main() — no CLI arg
// parsing involved.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditDuplicateLeadPhones } from "../audit-duplicate-lead-phones";
import {
  cleanupTestFixture,
  createDecisionRecordFixture,
  createTestFixture,
  getTestPrisma,
  shouldRunDbTests,
  type TestFixture,
} from "../../../persistence/__tests__/test-db";

describe.skipIf(!shouldRunDbTests)("auditDuplicateLeadPhones (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "phone-audit"); // base lead: phone "+10000000000"
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
  });

  it("groups two leads with the same real number in different raw formats", async () => {
    const dup1 = await db!.lead.create({ data: { businessId: fixture.businessId, name: "prueba", phone: "51933517901" } });
    const dup2 = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Juan Pérez", phone: "+51933517901" } });
    try {
      const result = await auditDuplicateLeadPhones(db!, fixture.businessId);

      expect(result.duplicateGroups).toHaveLength(1);
      const group = result.duplicateGroups[0];
      expect(group.businessId).toBe(fixture.businessId);
      expect(group.normalizedPhone).toBe("+51933517901");
      expect(group.leads.map((l) => l.leadId).sort()).toEqual([dup1.id, dup2.id].sort());
      expect(group.leads.map((l) => l.rawPhone).sort()).toEqual(["+51933517901", "51933517901"]);
    } finally {
      await db!.lead.deleteMany({ where: { id: { in: [dup1.id, dup2.id] } } });
    }
  });

  it("reports status/priority/conversationCount/followUpCount/openFollowUpCount/hasCommercialProfile/assignedAgent per lead in the group", async () => {
    const dup1 = await db!.lead.create({
      data: {
        businessId: fixture.businessId,
        name: "prueba",
        phone: "51900000001",
        assignedToUserId: fixture.userId,
        status: "CONTACTED",
        priority: "HIGH",
      },
    });
    const dup2 = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Real Name", phone: "+51900000001" } });
    await db!.leadCommercialProfile.create({
      data: {
        leadId: dup2.id,
        businessId: fixture.businessId,
        vehicleBrand: "Toyota",
        vehicleModel: "Hilux",
        vehicleYear: 2022,
        productInterest: "TRAVO kit",
        customerType: "RETAIL",
        nextAction: "SEND_QUOTE",
        primaryObjection: "price",
      },
    });
    await db!.followUp.create({ data: { leadId: dup1.id, userId: fixture.userId, dueAt: new Date(), status: "PENDING" } });
    await db!.followUp.create({ data: { leadId: dup1.id, userId: fixture.userId, dueAt: new Date(), status: "DONE" } });

    try {
      const result = await auditDuplicateLeadPhones(db!, fixture.businessId);
      const group = result.duplicateGroups.find((g) => g.normalizedPhone === "+51900000001");
      expect(group).toBeDefined();

      const member1 = group!.leads.find((l) => l.leadId === dup1.id)!;
      expect(member1.status).toBe("CONTACTED");
      expect(member1.priority).toBe("HIGH");
      expect(member1.followUpCount).toBe(2);
      expect(member1.openFollowUpCount).toBe(1); // only the PENDING one
      expect(member1.hasCommercialProfile).toBe(false);
      expect(member1.commercialProfile).toBeNull();
      expect(member1.assignedAgentId).toBe(fixture.userId);
      expect(member1.assignedAgentName).not.toBeNull();

      const member2 = group!.leads.find((l) => l.leadId === dup2.id)!;
      expect(member2.hasCommercialProfile).toBe(true);
      expect(member2.commercialProfile).toEqual({
        vehicleBrand: "Toyota",
        vehicleModel: "Hilux",
        vehicleYear: 2022,
        productInterest: "TRAVO kit",
        customerType: "RETAIL",
        nextAction: "SEND_QUOTE",
        primaryObjection: "price",
      });
      expect(member2.assignedAgentId).toBeNull();
      expect(member2.assignedAgentName).toBeNull();
    } finally {
      await db!.leadCommercialProfile.deleteMany({ where: { leadId: dup2.id } });
      await db!.followUp.deleteMany({ where: { leadId: dup1.id } });
      await db!.lead.deleteMany({ where: { id: { in: [dup1.id, dup2.id] } } });
    }
  });

  it("reports the latest conversation's lastEntryAt/status (top-1 by lastEntryAt) and outcomeCount per lead", async () => {
    const dup1 = await db!.lead.create({ data: { businessId: fixture.businessId, name: "prueba", phone: "51900000002" } });
    const dup2 = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Real Name", phone: "+51900000002" } });

    const olderConv = await db!.conversation.create({
      data: {
        businessId: fixture.businessId,
        leadId: dup1.id,
        source: "MANUAL_PASTE",
        status: "CLOSED",
        lastEntryAt: new Date("2026-01-01T00:00:00Z"),
        lastEntryDirection: "INBOUND",
        createdByUserId: fixture.userId,
      },
    });
    const newerConv = await db!.conversation.create({
      data: {
        businessId: fixture.businessId,
        leadId: dup1.id,
        source: "MANUAL_PASTE",
        status: "NEEDS_REPLY",
        lastEntryAt: new Date("2026-02-01T00:00:00Z"),
        lastEntryDirection: "INBOUND",
        createdByUserId: fixture.userId,
      },
    });

    // dup1 gets a recorded outcome hanging off its newer conversation.
    const decisionRecordId = await createDecisionRecordFixture(db!, {
      businessId: fixture.businessId,
      userId: fixture.userId,
      leadId: dup1.id,
      conversationId: newerConv.id,
    });
    const outcome = await db!.outcome.create({ data: { decisionRecordId, outcomeType: "SALE_CLOSED" } });

    try {
      const result = await auditDuplicateLeadPhones(db!, fixture.businessId);
      const group = result.duplicateGroups.find((g) => g.normalizedPhone === "+51900000002");
      expect(group).toBeDefined();

      const member1 = group!.leads.find((l) => l.leadId === dup1.id)!;
      expect(member1.conversationCount).toBe(2);
      expect(member1.latestConversationLastEntryAt?.toISOString()).toBe(newerConv.lastEntryAt.toISOString());
      expect(member1.latestConversationStatus).toBe("NEEDS_REPLY");
      expect(member1.outcomeCount).toBe(1);

      const member2 = group!.leads.find((l) => l.leadId === dup2.id)!;
      expect(member2.conversationCount).toBe(0);
      expect(member2.latestConversationLastEntryAt).toBeNull();
      expect(member2.latestConversationStatus).toBeNull();
      expect(member2.outcomeCount).toBe(0);
    } finally {
      await db!.outcome.delete({ where: { id: outcome.id } });
      await db!.decisionRecord.delete({ where: { id: decisionRecordId } });
      await db!.conversation.deleteMany({ where: { id: { in: [olderConv.id, newerConv.id] } } });
      await db!.lead.deleteMany({ where: { id: { in: [dup1.id, dup2.id] } } });
    }
  });

  it("does NOT group leads with genuinely different phone numbers", async () => {
    const single = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Different Number", phone: "+51900000099" } });
    try {
      const result = await auditDuplicateLeadPhones(db!, fixture.businessId);
      const group = result.duplicateGroups.find((g) => g.normalizedPhone === "+51900000099");
      expect(group).toBeUndefined();
    } finally {
      await db!.lead.delete({ where: { id: single.id } });
    }
  });

  it("counts an unparseable stored phone separately, never crashing or grouping it, and excludes it from normalizedLeadCount", async () => {
    const garbage = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Legacy Garbage", phone: "not-a-real-phone" } });
    try {
      const result = await auditDuplicateLeadPhones(db!, fixture.businessId);
      expect(result.unparseablePhoneCount).toBeGreaterThanOrEqual(1);
      expect(result.normalizedLeadCount).toBe(result.scannedLeadCount - result.unparseablePhoneCount);
      expect(result.duplicateGroups.every((g) => g.leads.every((l) => l.leadId !== garbage.id))).toBe(true);
    } finally {
      await db!.lead.delete({ where: { id: garbage.id } });
    }
  });

  it("tenant isolation — the same real number for two different businesses forms two separate groups, not one merged across tenants", async () => {
    const other = await createTestFixture(db!, "phone-audit-other");
    const mineA = await db!.lead.create({ data: { businessId: fixture.businessId, name: "A1", phone: "51922222222" } });
    const mineB = await db!.lead.create({ data: { businessId: fixture.businessId, name: "A2", phone: "+51922222222" } });
    const theirsA = await db!.lead.create({ data: { businessId: other.businessId, name: "B1", phone: "51922222222" } });
    const theirsB = await db!.lead.create({ data: { businessId: other.businessId, name: "B2", phone: "+51922222222" } });

    try {
      const result = await auditDuplicateLeadPhones(db!); // no businessId filter — scans everything
      const groupsForThisPhone = result.duplicateGroups.filter((g) => g.normalizedPhone === "+51922222222");
      expect(groupsForThisPhone).toHaveLength(2);

      const mineGroup = groupsForThisPhone.find((g) => g.businessId === fixture.businessId)!;
      const theirsGroup = groupsForThisPhone.find((g) => g.businessId === other.businessId)!;
      expect(mineGroup.leads.map((l) => l.leadId).sort()).toEqual([mineA.id, mineB.id].sort());
      expect(theirsGroup.leads.map((l) => l.leadId).sort()).toEqual([theirsA.id, theirsB.id].sort());
      expect(result.businessesAffected).toBeGreaterThanOrEqual(2);
    } finally {
      await db!.lead.deleteMany({ where: { id: { in: [mineA.id, mineB.id, theirsA.id, theirsB.id] } } });
      await cleanupTestFixture(db!, other);
    }
  });

  it("Phase B — attaches a survivorRecommendation to each group, favoring the non-placeholder-named lead, and counts it in duplicateLeadRowsBeyondFirstSurvivor", async () => {
    const placeholder = await db!.lead.create({ data: { businessId: fixture.businessId, name: "51900000003", phone: "51900000003" } });
    const nonPlaceholderNamed = await db!.lead.create({ data: { businessId: fixture.businessId, name: "María López", phone: "+51900000003" } });

    try {
      const result = await auditDuplicateLeadPhones(db!, fixture.businessId);
      const group = result.duplicateGroups.find((g) => g.normalizedPhone === "+51900000003");
      expect(group).toBeDefined();

      expect(group!.survivorRecommendation.recommendedSurvivorLeadId).toBe(nonPlaceholderNamed.id);
      expect(group!.survivorRecommendation.loserLeadIds).toEqual([placeholder.id]);
      expect(group!.survivorRecommendation.survivorReasonSummary).toContain("non-placeholder name");
      expect(result.duplicateLeadRowsBeyondFirstSurvivor).toBeGreaterThanOrEqual(1);
    } finally {
      await db!.lead.deleteMany({ where: { id: { in: [placeholder.id, nonPlaceholderNamed.id] } } });
    }
  });

  it("is provably read-only — never calls a Lead/Outcome write method", async () => {
    const createSpy = vi.spyOn(db!.lead, "create");
    const updateSpy = vi.spyOn(db!.lead, "update");
    const deleteSpy = vi.spyOn(db!.lead, "delete");
    const upsertSpy = vi.spyOn(db!.lead, "upsert");
    const outcomeCreateSpy = vi.spyOn(db!.outcome, "create");
    const outcomeUpdateSpy = vi.spyOn(db!.outcome, "update");
    const outcomeDeleteSpy = vi.spyOn(db!.outcome, "delete");
    const rawSpy = vi.spyOn(db!, "$queryRaw");
    const execSpy = vi.spyOn(db!, "$executeRaw");

    await auditDuplicateLeadPhones(db!, fixture.businessId);

    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(outcomeCreateSpy).not.toHaveBeenCalled();
    expect(outcomeUpdateSpy).not.toHaveBeenCalled();
    expect(outcomeDeleteSpy).not.toHaveBeenCalled();
    expect(rawSpy).not.toHaveBeenCalled();
    expect(execSpy).not.toHaveBeenCalled();
  });

  it("scanning without a businessId filter still includes this business's leads", async () => {
    const result = await auditDuplicateLeadPhones(db!);
    expect(result.scannedLeadCount).toBeGreaterThanOrEqual(1); // at least the base fixture lead
  });
});
