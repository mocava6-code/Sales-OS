// Gated: proves executeKoriQuery against real Postgres (sales_os_test) —
// tenant isolation, limit enforcement, every filter/groupBy/operation this
// phase supports, and — critically — that no raw SQL and no write ever
// occurs, across a battery of diverse (including adversarial-looking)
// inputs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidKoriQuerySpecError } from "../errors";
import { executeKoriQuery } from "../query-executor";
import { createDecisionRecordFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "../../persistence/__tests__/test-db";

type Db = ReturnType<typeof getTestPrisma>;

interface CreateLeadOptions {
  name?: string;
  phone: string;
  status?: "NEW" | "CONTACTED" | "FOLLOW_UP" | "WON" | "LOST";
  priority?: "NORMAL" | "HIGH";
  assignedToUserId?: string | null;
  createdAt?: Date;
  profile?: {
    vehicleBrand?: string;
    vehicleModel?: string;
    productInterest?: string;
    customerType?: "RETAIL" | "WHOLESALE" | "UNKNOWN";
  };
  conversation?: { status?: "NEEDS_REPLY" | "WAITING_ON_CUSTOMER" | "CLOSED"; lastEntryAt?: Date };
  followUp?: { status?: "PENDING" | "DONE" | "SNOOZED"; dueAt: Date };
}

async function createLead(db: Db, businessId: string, userId: string, opts: CreateLeadOptions) {
  const lead = await db.lead.create({
    data: {
      businessId,
      name: opts.name ?? "Test Lead",
      phone: opts.phone,
      status: opts.status ?? "NEW",
      priority: opts.priority ?? "NORMAL",
      assignedToUserId: opts.assignedToUserId,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });

  if (opts.profile) {
    await db.leadCommercialProfile.create({ data: { leadId: lead.id, businessId, ...opts.profile } });
  }

  let conversation: { id: string } | null = null;
  if (opts.conversation) {
    conversation = await db.conversation.create({
      data: {
        businessId,
        leadId: lead.id,
        source: "MANUAL_PASTE",
        status: opts.conversation.status ?? "NEEDS_REPLY",
        lastEntryAt: opts.conversation.lastEntryAt ?? new Date(),
        lastEntryDirection: "INBOUND",
        createdByUserId: userId,
      },
    });
  }

  if (opts.followUp) {
    await db.followUp.create({ data: { leadId: lead.id, userId, dueAt: opts.followUp.dueAt, status: opts.followUp.status ?? "PENDING" } });
  }

  return { lead, conversation };
}

async function createOutcome(
  db: Db,
  fixtureLike: TestFixture,
  outcomeType: "SALE_CLOSED" | "SALE_LOST" | "QUOTATION_SENT" | "QUOTATION_REQUESTED",
  occurredAt: Date,
) {
  const decisionRecordId = await createDecisionRecordFixture(db, fixtureLike);
  return db.outcome.create({ data: { decisionRecordId, outcomeType, occurredAt } });
}

/** Sweeps everything for a businessId (base fixture lead + every lead created in a test), then deletes user/business. */
async function cleanupBusiness(db: Db, businessId: string, userId: string) {
  const leads = await db.lead.findMany({ where: { businessId }, select: { id: true } });
  const leadIds = leads.map((l) => l.id);
  const conversations = await db.conversation.findMany({ where: { leadId: { in: leadIds } }, select: { id: true } });
  const conversationIds = conversations.map((c) => c.id);

  await db.outcome.deleteMany({ where: { decisionRecord: { conversationId: { in: conversationIds } } } });
  await db.decisionEvent.deleteMany({ where: { decisionRecord: { conversationId: { in: conversationIds } } } });
  await db.decisionRecord.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await db.conversationEntry.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await db.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  await db.followUp.deleteMany({ where: { leadId: { in: leadIds } } });
  await db.leadCommercialProfile.deleteMany({ where: { leadId: { in: leadIds } } });
  await db.lead.deleteMany({ where: { id: { in: leadIds } } });
  await db.user.delete({ where: { id: userId } });
  await db.business.delete({ where: { id: businessId } });
}

describe.skipIf(!shouldRunDbTests)("executeKoriQuery (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "kori-query");
  });

  afterEach(async () => {
    await cleanupBusiness(db!, fixture.businessId, fixture.userId);
  });

  it("rejects an invalid operation before touching the database", async () => {
    await expect(executeKoriQuery({ businessId: fixture.businessId, querySpec: { operation: "DELETE_LEADS" }, db: db! })).rejects.toBeInstanceOf(
      InvalidKoriQuerySpecError,
    );
  });

  it("rejects invalid filters before touching the database", async () => {
    await expect(
      executeKoriQuery({ businessId: fixture.businessId, querySpec: { operation: "COUNT_LEADS", filters: { leadStatus: "ARCHIVED" } }, db: db! }),
    ).rejects.toBeInstanceOf(InvalidKoriQuerySpecError);
  });

  it("filters by vehicleBrand, case-insensitively via normalization", async () => {
    await createLead(db!, fixture.businessId, fixture.userId, { phone: "+10000000001", profile: { vehicleBrand: "Toyota" } });
    await createLead(db!, fixture.businessId, fixture.userId, { phone: "+10000000002", profile: { vehicleBrand: "Ford" } });

    const result = await executeKoriQuery({
      businessId: fixture.businessId,
      querySpec: { operation: "COUNT_LEADS", filters: { vehicleBrand: "toyota" } },
      db: db!,
    });

    expect(result).toEqual({ type: "count", count: 1 });
  });

  it("filters by needsReply", async () => {
    // createTestFixture's own base lead/conversation defaults to status
    // NEEDS_REPLY (unset -> schema default) — accounted for explicitly
    // below rather than fighting it, since that base fixture is this
    // codebase's established convention.
    await createLead(db!, fixture.businessId, fixture.userId, { phone: "+10000000003", conversation: { status: "NEEDS_REPLY" } });
    await createLead(db!, fixture.businessId, fixture.userId, { phone: "+10000000004", conversation: { status: "WAITING_ON_CUSTOMER" } });

    const needsReply = await executeKoriQuery({
      businessId: fixture.businessId,
      querySpec: { operation: "COUNT_LEADS", filters: { needsReply: true } },
      db: db!,
    });
    const doesNotNeedReply = await executeKoriQuery({
      businessId: fixture.businessId,
      querySpec: { operation: "COUNT_LEADS", filters: { needsReply: false } },
      db: db!,
    });

    expect(needsReply).toEqual({ type: "count", count: 2 }); // base fixture lead + the one explicitly created above
    expect(doesNotNeedReply).toEqual({ type: "count", count: 1 });
  });

  it("combines vehicleBrand + needsReply", async () => {
    await createLead(db!, fixture.businessId, fixture.userId, {
      phone: "+10000000005",
      profile: { vehicleBrand: "Toyota" },
      conversation: { status: "NEEDS_REPLY" },
    });
    await createLead(db!, fixture.businessId, fixture.userId, {
      phone: "+10000000006",
      profile: { vehicleBrand: "Toyota" },
      conversation: { status: "WAITING_ON_CUSTOMER" },
    });
    await createLead(db!, fixture.businessId, fixture.userId, {
      phone: "+10000000007",
      profile: { vehicleBrand: "Ford" },
      conversation: { status: "NEEDS_REPLY" },
    });

    const result = await executeKoriQuery({
      businessId: fixture.businessId,
      querySpec: { operation: "LIST_LEADS", filters: { vehicleBrand: "Toyota", needsReply: true } },
      db: db!,
    });

    expect(result.type).toBe("lead_list");
    if (result.type === "lead_list") {
      expect(result.count).toBe(1);
      expect(result.rows[0].phone).toBe("+10000000005");
    }
  });

  it("filters by productInterest", async () => {
    await createLead(db!, fixture.businessId, fixture.userId, { phone: "+10000000008", profile: { productInterest: "TRAVO" } });
    await createLead(db!, fixture.businessId, fixture.userId, { phone: "+10000000009", profile: { productInterest: "kit" } });

    const result = await executeKoriQuery({
      businessId: fixture.businessId,
      querySpec: { operation: "COUNT_LEADS", filters: { productInterest: "travo" } },
      db: db!,
    });

    expect(result).toEqual({ type: "count", count: 1 });
  });

  it("groups leads by vehicleBrand", async () => {
    await createLead(db!, fixture.businessId, fixture.userId, { phone: "+10000000010", profile: { vehicleBrand: "Toyota" } });
    await createLead(db!, fixture.businessId, fixture.userId, { phone: "+10000000011", profile: { vehicleBrand: "Toyota" } });
    await createLead(db!, fixture.businessId, fixture.userId, { phone: "+10000000012", profile: { vehicleBrand: "Ford" } });

    const result = await executeKoriQuery({
      businessId: fixture.businessId,
      querySpec: { operation: "GROUP_LEADS", groupBy: "vehicleBrand" },
      db: db!,
    });

    expect(result.type).toBe("grouped_result");
    if (result.type === "grouped_result") {
      // "Unknown" is the base fixture's own lead — it has no commercial profile.
      expect(result.groups).toEqual(
        expect.arrayContaining([
          { key: "Toyota", count: 2 },
          { key: "Ford", count: 1 },
          { key: "Unknown", count: 1 },
        ]),
      );
      expect(result.groups).toHaveLength(3);
      expect(result.groups[0]).toEqual({ key: "Toyota", count: 2 }); // highest count sorts first
    }
  });

  it("PRODUCT_RANKING groups by productInterest, sorted by count desc", async () => {
    await createLead(db!, fixture.businessId, fixture.userId, { phone: "+10000000013", profile: { productInterest: "TRAVO" } });
    await createLead(db!, fixture.businessId, fixture.userId, { phone: "+10000000014", profile: { productInterest: "TRAVO" } });
    await createLead(db!, fixture.businessId, fixture.userId, { phone: "+10000000015", profile: { productInterest: "TRAVO" } });
    await createLead(db!, fixture.businessId, fixture.userId, { phone: "+10000000016", profile: { productInterest: "kit" } });

    const result = await executeKoriQuery({ businessId: fixture.businessId, querySpec: { operation: "PRODUCT_RANKING" }, db: db! });

    expect(result.type).toBe("grouped_result");
    if (result.type === "grouped_result") {
      // "Unknown" is the base fixture's own lead — it has no commercial profile.
      expect(result.groups).toEqual(
        expect.arrayContaining([
          { key: "TRAVO", count: 3 },
          { key: "kit", count: 1 },
          { key: "Unknown", count: 1 },
        ]),
      );
      expect(result.groups).toHaveLength(3);
      expect(result.groups[0]).toEqual({ key: "TRAVO", count: 3 }); // ranking: highest count first
    }
  });

  it("FOLLOW_UP_QUEUE with overdueFollowUp only returns PENDING + past-due, never SNOOZED", async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await createLead(db!, fixture.businessId, fixture.userId, { phone: "+10000000017", followUp: { status: "PENDING", dueAt: past } });
    await createLead(db!, fixture.businessId, fixture.userId, { phone: "+10000000018", followUp: { status: "SNOOZED", dueAt: past } });
    await createLead(db!, fixture.businessId, fixture.userId, { phone: "+10000000019", followUp: { status: "PENDING", dueAt: future } });

    const result = await executeKoriQuery({
      businessId: fixture.businessId,
      querySpec: { operation: "FOLLOW_UP_QUEUE", filters: { overdueFollowUp: true } },
      db: db!,
    });

    expect(result.type).toBe("lead_list");
    if (result.type === "lead_list") {
      expect(result.count).toBe(1);
      expect(result.rows[0].phone).toBe("+10000000017");
    }
  });

  it("filters by createdFrom/createdTo date range", async () => {
    await createLead(db!, fixture.businessId, fixture.userId, { phone: "+10000000020", createdAt: new Date("2026-01-01T00:00:00Z") });
    await createLead(db!, fixture.businessId, fixture.userId, { phone: "+10000000021", createdAt: new Date("2026-06-01T00:00:00Z") });
    await createLead(db!, fixture.businessId, fixture.userId, { phone: "+10000000022", createdAt: new Date("2026-12-01T00:00:00Z") });

    const result = await executeKoriQuery({
      businessId: fixture.businessId,
      querySpec: { operation: "COUNT_LEADS", filters: { createdFrom: "2026-05-01T00:00:00Z", createdTo: "2026-07-01T00:00:00Z" } },
      db: db!,
    });

    expect(result).toEqual({ type: "count", count: 1 });
  });

  it("counts outcomes by outcomeType and date range", async () => {
    const { conversation } = await createLead(db!, fixture.businessId, fixture.userId, { phone: "+10000000023", conversation: {} });
    const fixtureLike: TestFixture = { ...fixture, conversationId: conversation!.id };
    await createOutcome(db!, fixtureLike, "SALE_CLOSED", new Date("2026-08-05T00:00:00Z"));
    await createOutcome(db!, fixtureLike, "SALE_CLOSED", new Date("2026-08-06T00:00:00Z"));
    await createOutcome(db!, fixtureLike, "SALE_LOST", new Date("2026-08-06T00:00:00Z"));

    const saleClosedCount = await executeKoriQuery({
      businessId: fixture.businessId,
      querySpec: { operation: "COUNT_OUTCOMES", filters: { outcomeType: "SALE_CLOSED" } },
      db: db!,
    });
    const dateRangeCount = await executeKoriQuery({
      businessId: fixture.businessId,
      querySpec: {
        operation: "COUNT_OUTCOMES",
        filters: { outcomeType: "SALE_CLOSED", createdFrom: "2026-08-06T00:00:00Z", createdTo: "2026-08-06T23:59:59Z" },
      },
      db: db!,
    });

    expect(saleClosedCount).toEqual({ type: "count", count: 2 });
    expect(dateRangeCount).toEqual({ type: "count", count: 1 });
  });

  it("tenant isolation — identical filters never cross businesses", async () => {
    const other = await createTestFixture(db!, "kori-query-other");
    try {
      await createLead(db!, fixture.businessId, fixture.userId, { phone: "+10000000024", profile: { vehicleBrand: "Toyota" } });
      await createLead(db!, other.businessId, other.userId, { phone: "+10000000024", profile: { vehicleBrand: "Toyota" } });

      const mine = await executeKoriQuery({
        businessId: fixture.businessId,
        querySpec: { operation: "COUNT_LEADS", filters: { vehicleBrand: "Toyota" } },
        db: db!,
      });
      const theirs = await executeKoriQuery({
        businessId: other.businessId,
        querySpec: { operation: "COUNT_LEADS", filters: { vehicleBrand: "Toyota" } },
        db: db!,
      });

      expect(mine).toEqual({ type: "count", count: 1 });
      expect(theirs).toEqual({ type: "count", count: 1 });
    } finally {
      await cleanupBusiness(db!, other.businessId, other.userId);
    }
  });

  it("enforces the maximum limit — total count is accurate, rows are capped", async () => {
    const data = Array.from({ length: 105 }, (_, i) => ({
      businessId: fixture.businessId,
      name: `Bulk Lead ${i}`,
      phone: `+1900000${String(i).padStart(4, "0")}`,
      status: "NEW" as const,
    }));
    await db!.lead.createMany({ data });

    const result = await executeKoriQuery({
      businessId: fixture.businessId,
      querySpec: { operation: "LIST_LEADS", filters: { leadStatus: "NEW" }, limit: 100 },
      db: db!,
    });

    expect(result.type).toBe("lead_list");
    if (result.type === "lead_list") {
      // 106, not 105: the base fixture's own lead also defaults to status NEW.
      expect(result.count).toBe(106);
      expect(result.rows).toHaveLength(100);
    }
  });

  it("never issues raw SQL or a write query, across a battery of diverse (including adversarial-looking) inputs", async () => {
    const querySpecs: unknown[] = [
      { operation: "COUNT_LEADS" },
      { operation: "LIST_LEADS", filters: { vehicleBrand: "'; DROP TABLE leads; --" } },
      { operation: "GROUP_LEADS", groupBy: "productInterest" },
      { operation: "FOLLOW_UP_QUEUE", filters: { overdueFollowUp: true } },
      { operation: "COUNT_OUTCOMES", filters: { outcomeType: "SALE_CLOSED" } },
      { operation: "PRODUCT_RANKING" },
      { operation: "COUNT_LEADS", filters: { productInterest: "TRAVO\" OR \"1\"=\"1" } },
    ];

    const rawSpy = vi.spyOn(db!, "$queryRaw");
    const rawUnsafeSpy = vi.spyOn(db!, "$queryRawUnsafe");
    const execSpy = vi.spyOn(db!, "$executeRaw");
    const execUnsafeSpy = vi.spyOn(db!, "$executeRawUnsafe");
    const leadCreateSpy = vi.spyOn(db!.lead, "create");
    const leadUpdateSpy = vi.spyOn(db!.lead, "update");
    const leadDeleteSpy = vi.spyOn(db!.lead, "delete");
    const leadUpsertSpy = vi.spyOn(db!.lead, "upsert");

    for (const querySpec of querySpecs) {
      await executeKoriQuery({ businessId: fixture.businessId, querySpec, db: db! });
    }

    expect(rawSpy).not.toHaveBeenCalled();
    expect(rawUnsafeSpy).not.toHaveBeenCalled();
    expect(execSpy).not.toHaveBeenCalled();
    expect(execUnsafeSpy).not.toHaveBeenCalled();
    expect(leadCreateSpy).not.toHaveBeenCalled();
    expect(leadUpdateSpy).not.toHaveBeenCalled();
    expect(leadDeleteSpy).not.toHaveBeenCalled();
    expect(leadUpsertSpy).not.toHaveBeenCalled();

    rawSpy.mockRestore();
    rawUnsafeSpy.mockRestore();
    execSpy.mockRestore();
    execUnsafeSpy.mockRestore();
    leadCreateSpy.mockRestore();
    leadUpdateSpy.mockRestore();
    leadDeleteSpy.mockRestore();
    leadUpsertSpy.mockRestore();
  });
});
