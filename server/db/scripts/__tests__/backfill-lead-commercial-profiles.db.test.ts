// Gated: proves runBackfill's dry-run/live/re-run/failure-isolation
// behavior against real Postgres (sales_os_test). Imports runBackfill
// directly, never main() — no CLI arg parsing involved.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBackfill } from "../backfill-lead-commercial-profiles";
import {
  cleanupTestFixture,
  createTestFixture,
  getTestPrisma,
  shouldRunDbTests,
  type TestFixture,
} from "../../../persistence/__tests__/test-db";

describe.skipIf(!shouldRunDbTests)("runBackfill (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "backfill");
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
  });

  it("dry-run performs zero writes while still reporting accurate would-be counts", async () => {
    const before = await db!.leadCommercialProfile.count({ where: { businessId: fixture.businessId } });

    const result = await runBackfill({ businessId: fixture.businessId, dryRun: true, batchSize: 50 }, db!);

    const after = await db!.leadCommercialProfile.count({ where: { businessId: fixture.businessId } });
    expect(after).toBe(before);
    expect(result.scanned).toBe(1);
    // createTestFixture's conversation defaults to status NEEDS_REPLY with no
    // conversations[].entries — the deterministic engine still resolves
    // nextAction from conversation.status alone, so this lead has a
    // would-be create.
    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.failures).toHaveLength(0);
  });

  it("is safely re-runnable — a second live run after the first reports zero new changes", async () => {
    const first = await runBackfill({ businessId: fixture.businessId, dryRun: false, batchSize: 50 }, db!);
    expect(first.created).toBe(1);

    const second = await runBackfill({ businessId: fixture.businessId, dryRun: false, batchSize: 50 }, db!);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("isolates a per-lead failure — one bad lead never aborts the batch", async () => {
    const secondLead = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Second Lead", phone: "+10000000321" } });
    await db!.conversation.create({
      data: {
        businessId: fixture.businessId,
        leadId: secondLead.id,
        source: "MANUAL_PASTE",
        lastEntryAt: new Date(),
        lastEntryDirection: "INBOUND",
        createdByUserId: fixture.userId,
      },
    });

    // Force a genuine failure for exactly fixture.leadId by spying on
    // db.lead.findFirst (getLead's own query, called from
    // computeLeadCommercialProfileUpdate) — every other call (lead.findMany's
    // own batch listing, secondLead's projection, every other model) keeps
    // its real implementation via mockImplementation's fallthrough.
    //
    // Uses dryRun: true deliberately: the live path's projectLeadCommercialProfile
    // wraps everything in db.$transaction(), which hands
    // computeLeadCommercialProfileUpdate a Prisma-generated transaction
    // client (tx) — a distinct object from `db`, so a spy on `db.lead`
    // would never be reached inside it. Dry-run calls
    // computeLeadCommercialProfileUpdate directly with the plain `db`,
    // exercising the exact same per-lead try/catch loop in runBackfill.
    const realFindFirst = db!.lead.findFirst.bind(db!.lead);
    const findFirstSpy = vi.spyOn(db!.lead, "findFirst").mockImplementation(((args: { where?: { id?: string } } | undefined) => {
      if (args?.where?.id === fixture.leadId) {
        return Promise.reject(new Error("simulated database failure"));
      }
      return realFindFirst(args as never);
    }) as never);

    try {
      const result = await runBackfill({ businessId: fixture.businessId, dryRun: true, batchSize: 50 }, db!);

      expect(result.scanned).toBe(2);
      expect(result.failures).toEqual([{ leadId: fixture.leadId, message: "simulated database failure" }]);
      // secondLead's would-be projection still computed successfully despite
      // fixture.leadId's failure — the batch was not aborted.
      expect(result.created).toBe(1);
    } finally {
      findFirstSpy.mockRestore();
      await db!.leadCommercialProfile.deleteMany({ where: { leadId: secondLead.id } });
      await db!.conversation.deleteMany({ where: { leadId: secondLead.id } });
      await db!.lead.delete({ where: { id: secondLead.id } });
    }
  });
});
