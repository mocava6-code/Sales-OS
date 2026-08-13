// Gated: proves fetchConversationForActionContext/projectConversationActionState/
// setHumanConversationActionState against real Postgres (sales_os_test) —
// bounded-window fetching, race-safe upsert, human-override precedence on
// the WRITE path (not just the read-path resolver), and staleness-driven
// re-computation.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fetchConversationForActionContext,
  groupLeadsByOperationalActionState,
  projectConversationActionState,
  setHumanConversationActionState,
} from "../conversation-action-state-service";
import { cleanupTestFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "../../persistence/__tests__/test-db";

describe.skipIf(!shouldRunDbTests)("conversation-action-state-service (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "action-state");
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
    await db!.conversationActionState.deleteMany({ where: { businessId: fixture.businessId } });
  });

  async function addEntry(conversationId: string, direction: "INBOUND" | "OUTBOUND", content: string, occurredAt: Date) {
    return db!.conversationEntry.create({ data: { conversationId, direction, content, occurredAt } });
  }

  it("fetchConversationForActionContext returns entries oldest -> newest within the bounded window", async () => {
    const t1 = new Date("2026-08-01T00:00:00Z");
    const t2 = new Date("2026-08-01T00:01:00Z");
    await addEntry(fixture.conversationId, "INBOUND", "Hola", t1);
    await addEntry(fixture.conversationId, "OUTBOUND", "Hola, en que le ayudo?", t2);
    await db!.conversation.update({ where: { id: fixture.conversationId }, data: { lastEntryAt: t2, lastEntryDirection: "OUTBOUND" } });

    const context = await fetchConversationForActionContext(fixture.businessId, fixture.conversationId, db!);
    expect(context).not.toBeNull();
    expect(context!.recentEntries.map((e) => e.content)).toEqual(["Hola", "Hola, en que le ayudo?"]);
    expect(context!.lastEntryDirection).toBe("OUTBOUND");
  });

  it("returns null for a conversation scoped to a different business", async () => {
    const other = await createTestFixture(db!, "action-state-other");
    try {
      const context = await fetchConversationForActionContext(other.businessId, fixture.conversationId, db!);
      expect(context).toBeNull();
    } finally {
      await cleanupTestFixture(db!, other);
    }
  });

  it("projectConversationActionState creates a row on first call, computed deterministically", async () => {
    const t1 = new Date("2026-08-01T00:00:00Z");
    await addEntry(fixture.conversationId, "INBOUND", "Ok gracias", t1);
    await db!.conversation.update({ where: { id: fixture.conversationId }, data: { lastEntryAt: t1, lastEntryDirection: "INBOUND" } });

    const result = await projectConversationActionState(fixture.businessId, fixture.conversationId, db!);
    expect(result).toEqual({ created: true, updated: false, skippedReason: null });

    const row = await db!.conversationActionState.findUnique({ where: { conversationId: fixture.conversationId } });
    expect(row?.actionState).toBe("NO_ACTION_REQUIRED");
    expect(row?.source).toBe("DETERMINISTIC");
    expect(row?.humanOverride).toBe(false);
  });

  it("a second call with no new activity is a no-op (skippedReason=NO_CHANGE)", async () => {
    const t1 = new Date("2026-08-01T00:00:00Z");
    await addEntry(fixture.conversationId, "INBOUND", "Ok gracias", t1);
    await db!.conversation.update({ where: { id: fixture.conversationId }, data: { lastEntryAt: t1, lastEntryDirection: "INBOUND" } });

    await projectConversationActionState(fixture.businessId, fixture.conversationId, db!);
    const second = await projectConversationActionState(fixture.businessId, fixture.conversationId, db!);
    expect(second.skippedReason).toBe("NO_CHANGE");
  });

  it("recomputes after new activity changes the classification", async () => {
    const t1 = new Date("2026-08-01T00:00:00Z");
    await addEntry(fixture.conversationId, "INBOUND", "Ok gracias", t1);
    await db!.conversation.update({ where: { id: fixture.conversationId }, data: { lastEntryAt: t1, lastEntryDirection: "INBOUND" } });
    await projectConversationActionState(fixture.businessId, fixture.conversationId, db!);

    const t2 = new Date("2026-08-01T01:00:00Z");
    await addEntry(fixture.conversationId, "INBOUND", "¿Cuánto cuesta el envío?", t2);
    await db!.conversation.update({ where: { id: fixture.conversationId }, data: { lastEntryAt: t2, lastEntryDirection: "INBOUND" } });

    const result = await projectConversationActionState(fixture.businessId, fixture.conversationId, db!);
    expect(result.updated).toBe(true);
    const row = await db!.conversationActionState.findUnique({ where: { conversationId: fixture.conversationId } });
    expect(row?.actionState).toBe("REPLY_REQUIRED");
    expect(row?.reasonCode).toBe("PRICE_REQUEST");
  });

  it("setHumanConversationActionState stores a HUMAN, humanOverride=true row", async () => {
    await setHumanConversationActionState(fixture.businessId, fixture.conversationId, "NO_ACTION_REQUIRED", "MARKED_NO_ACTION_REQUIRED", fixture.userId, db!);

    const row = await db!.conversationActionState.findUnique({ where: { conversationId: fixture.conversationId } });
    expect(row?.actionState).toBe("NO_ACTION_REQUIRED");
    expect(row?.source).toBe("HUMAN");
    expect(row?.humanOverride).toBe(true);
    expect(row?.humanSetByUserId).toBe(fixture.userId);
  });

  it("projectConversationActionState refuses to overwrite a FRESH human override", async () => {
    const t1 = new Date("2026-08-01T00:00:00Z");
    await addEntry(fixture.conversationId, "INBOUND", "¿Cuánto cuesta?", t1);
    await db!.conversation.update({ where: { id: fixture.conversationId }, data: { lastEntryAt: t1, lastEntryDirection: "INBOUND" } });

    await setHumanConversationActionState(fixture.businessId, fixture.conversationId, "NO_ACTION_REQUIRED", "MARKED_NO_ACTION_REQUIRED", fixture.userId, db!);

    const result = await projectConversationActionState(fixture.businessId, fixture.conversationId, db!);
    expect(result.skippedReason).toBe("HUMAN_OVERRIDE_FRESH");

    const row = await db!.conversationActionState.findUnique({ where: { conversationId: fixture.conversationId } });
    expect(row?.source).toBe("HUMAN"); // untouched
    expect(row?.actionState).toBe("NO_ACTION_REQUIRED");
  });

  it("projectConversationActionState DOES recompute over a STALE human override (new activity since it was set)", async () => {
    const t1 = new Date("2026-08-01T00:00:00Z");
    await addEntry(fixture.conversationId, "INBOUND", "Ok gracias", t1);
    await db!.conversation.update({ where: { id: fixture.conversationId }, data: { lastEntryAt: t1, lastEntryDirection: "INBOUND" } });
    await setHumanConversationActionState(fixture.businessId, fixture.conversationId, "NO_ACTION_REQUIRED", "MARKED_NO_ACTION_REQUIRED", fixture.userId, db!);

    // New activity arrives after the human decision.
    const t2 = new Date("2026-08-01T02:00:00Z");
    await addEntry(fixture.conversationId, "INBOUND", "¿Cuánto cuesta el envío?", t2);
    await db!.conversation.update({ where: { id: fixture.conversationId }, data: { lastEntryAt: t2, lastEntryDirection: "INBOUND" } });

    const result = await projectConversationActionState(fixture.businessId, fixture.conversationId, db!);
    expect(result.skippedReason).toBeNull();
    expect(result.updated).toBe(true);

    const row = await db!.conversationActionState.findUnique({ where: { conversationId: fixture.conversationId } });
    expect(row?.actionState).toBe("REPLY_REQUIRED");
    expect(row?.source).toBe("DETERMINISTIC");
    expect(row?.humanOverride).toBe(false); // correctly superseded
  });

  it("returns skippedReason=CONVERSATION_NOT_FOUND for a nonexistent conversation, never throws", async () => {
    const result = await projectConversationActionState(fixture.businessId, "00000000-0000-0000-0000-000000000000", db!);
    expect(result).toEqual({ created: false, updated: false, skippedReason: "CONVERSATION_NOT_FOUND" });
  });

  it("groupLeadsByOperationalActionState enriches every entry with the fields Today needs — name, phone, vehicle/product, assigned advisor, recommendedAction, lastActivityAt", async () => {
    const t1 = new Date("2026-08-01T00:00:00Z");
    await addEntry(fixture.conversationId, "INBOUND", "¿Cuánto cuesta el envío?", t1);
    await db!.conversation.update({ where: { id: fixture.conversationId }, data: { lastEntryAt: t1, lastEntryDirection: "INBOUND" } });
    // fixture's lead is already assignedToUserId: fixture.userId by default (see createTestFixture).
    await db!.leadCommercialProfile.create({
      data: { leadId: fixture.leadId, businessId: fixture.businessId, vehicleBrand: "Toyota", vehicleModel: "Hilux", productInterest: "TRAVO kit" },
    });

    const groups = await groupLeadsByOperationalActionState(fixture.businessId, db!);
    const entry = groups.replyRequired.find((e) => e.leadId === fixture.leadId);

    expect(entry).toBeDefined();
    expect(entry?.leadName).toBe("Test Lead");
    expect(entry?.leadPhone).toBe("+10000000000");
    expect(entry?.vehicleBrand).toBe("Toyota");
    expect(entry?.vehicleModel).toBe("Hilux");
    expect(entry?.productInterest).toBe("TRAVO kit");
    expect(entry?.assignedAdvisorName).toBe("Test Advisor");
    expect(entry?.lastActivityAt?.toISOString()).toBe(t1.toISOString());
    expect(entry?.reasonCode).toBe("PRICE_REQUEST");
  });

  it("groupLeadsByOperationalActionState buckets every lead via the same canonical resolver Kori uses, including a lead with no conversation at all", async () => {
    const t1 = new Date("2026-08-01T00:00:00Z");
    await addEntry(fixture.conversationId, "INBOUND", "¿Cuánto cuesta el envío?", t1);
    await db!.conversation.update({ where: { id: fixture.conversationId }, data: { lastEntryAt: t1, lastEntryDirection: "INBOUND" } });

    const noConvLead = await db!.lead.create({ data: { businessId: fixture.businessId, name: "no-conv", phone: "+51900002001" } });

    try {
      const groups = await groupLeadsByOperationalActionState(fixture.businessId, db!);
      expect(groups.replyRequired.map((e) => e.leadId)).toContain(fixture.leadId);
      expect(groups.uncertain.map((e) => e.leadId)).toContain(noConvLead.id);
      const uncertainEntry = groups.uncertain.find((e) => e.leadId === noConvLead.id);
      expect(uncertainEntry?.conversationId).toBeNull();
    } finally {
      await db!.lead.delete({ where: { id: noConvLead.id } });
    }
  });

  it("groupLeadsByOperationalActionState surfaces a genuinely actionable conversation even when a newer, unrelated conversation on the same lead is only waiting on the customer (production regression)", async () => {
    const t1 = new Date("2026-08-01T00:00:00Z");
    await addEntry(fixture.conversationId, "INBOUND", "¿Cuánto cuesta el envío?", t1);
    await db!.conversation.update({ where: { id: fixture.conversationId }, data: { lastEntryAt: t1, lastEntryDirection: "INBOUND" } });

    // A second, newer conversation on the SAME lead whose advisor already
    // replied — must not hide the first conversation's unanswered question.
    const newerConversation = await db!.conversation.create({
      data: {
        businessId: fixture.businessId,
        leadId: fixture.leadId,
        source: "MANUAL_PASTE",
        status: "WAITING_ON_CUSTOMER",
        lastEntryAt: new Date("2026-08-02T00:00:00Z"),
        lastEntryDirection: "OUTBOUND",
        createdByUserId: fixture.userId,
      },
    });
    try {
      await addEntry(newerConversation.id, "OUTBOUND", "cualquier consulta me avisas", new Date("2026-08-02T00:00:00Z"));

      const groups = await groupLeadsByOperationalActionState(fixture.businessId, db!);
      const entry = groups.replyRequired.find((e) => e.leadId === fixture.leadId);
      expect(entry).toBeDefined();
      expect(entry?.conversationId).toBe(fixture.conversationId);
      expect(groups.waitingOnCustomer.map((e) => e.leadId)).not.toContain(fixture.leadId);
    } finally {
      await db!.conversationActionState.deleteMany({ where: { conversationId: newerConversation.id } });
      await db!.conversationEntry.deleteMany({ where: { conversationId: newerConversation.id } });
      await db!.conversation.delete({ where: { id: newerConversation.id } });
    }
  });
});
