import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaOutcomeRepository } from "../prisma/prisma-outcome-repository";
import {
  cleanupTestFixture,
  createDecisionRecordFixture,
  createTestFixture,
  getTestPrisma,
  shouldRunDbTests,
  type TestFixture,
} from "./test-db";

describe.skipIf(!shouldRunDbTests)("PrismaOutcomeRepository (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  const repo = db ? new PrismaOutcomeRepository(db) : undefined;
  let fixture: TestFixture;
  let decisionRecordId: string;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "outcome");
    decisionRecordId = await createDecisionRecordFixture(db!, fixture);
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
  });

  it("records a commercial outcome with notes", async () => {
    const outcome = await repo!.record({
      decisionRecordId,
      outcomeType: "QUOTATION_SENT",
      notes: "Sent a quote for the base trim kit.",
    });

    expect(outcome.id).toBeTruthy();
    expect(outcome.decisionRecordId).toBe(decisionRecordId);
    expect(outcome.outcomeType).toBe("QUOTATION_SENT");
    expect(outcome.notes).toBe("Sent a quote for the base trim kit.");
  });

  it("defaults notes to null when omitted", async () => {
    const outcome = await repo!.record({ decisionRecordId, outcomeType: "CUSTOMER_REPLIED" });
    expect(outcome.notes).toBeNull();
  });

  it("round-trips attribution, and defaults it to null when omitted", async () => {
    const attributed = await repo!.record({
      decisionRecordId,
      outcomeType: "SALE_CLOSED",
      attribution: "ADVISOR_ALTERNATIVE",
    });
    expect(attributed.attribution).toBe("ADVISOR_ALTERNATIVE");

    const unattributed = await repo!.record({ decisionRecordId, outcomeType: "CUSTOMER_REPLIED" });
    expect(unattributed.attribution).toBeNull();
  });

  it("is append-only: a decision's thread can accumulate a full outcome sequence over time", async () => {
    const replied = await repo!.record({ decisionRecordId, outcomeType: "CUSTOMER_REPLIED" });
    const requested = await repo!.record({ decisionRecordId, outcomeType: "QUOTATION_REQUESTED" });
    const sent = await repo!.record({ decisionRecordId, outcomeType: "QUOTATION_SENT" });
    const closed = await repo!.record({ decisionRecordId, outcomeType: "SALE_CLOSED" });

    const history = await repo!.listForDecision(decisionRecordId);

    expect(history.map((o) => o.id)).toEqual([replied.id, requested.id, sent.id, closed.id]);
    expect(history.map((o) => o.outcomeType)).toEqual([
      "CUSTOMER_REPLIED",
      "QUOTATION_REQUESTED",
      "QUOTATION_SENT",
      "SALE_CLOSED",
    ]);
  });

  it("supports SALE_LOST and ABANDONED", async () => {
    const lost = await repo!.record({ decisionRecordId, outcomeType: "SALE_LOST", notes: "Went with a competitor." });
    expect(lost.outcomeType).toBe("SALE_LOST");
  });
});
