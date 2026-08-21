// Gated: proves recordConversationOutcome (Kori Sales Memory v1's lightweight
// "Marcar resultado" write path) against real Postgres — writes a decision-less
// Outcome row with UNATTRIBUTED attribution by default, the exact fields
// passed through, and (since the decision-attribution linking work) an
// optional decisionRecordId + attribution when the caller supplies both.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildKoriDecision } from "../../intelligence/testing/fixtures";
import { PrismaDecisionRepository } from "../../persistence/prisma/prisma-decision-repository";
import { recordConversationOutcome } from "../outcome-service";
import { cleanupTestFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "../../persistence/__tests__/test-db";

describe.skipIf(!shouldRunDbTests)("recordConversationOutcome (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  const decisionRepo = db ? new PrismaDecisionRepository(db) : undefined;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "record-conversation-outcome");
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
  });

  it("1. writes a decision-less Outcome row with UNATTRIBUTED attribution and no decisionRecordId", async () => {
    const result = await recordConversationOutcome(
      fixture.businessId,
      fixture.conversationId,
      fixture.userId,
      { outcomeType: "SALE_CLOSED", lostReason: undefined, productSold: undefined, notes: undefined },
      db!,
    );

    const stored = await db!.outcome.findUnique({ where: { id: result.id } });
    expect(stored?.businessId).toBe(fixture.businessId);
    expect(stored?.conversationId).toBe(fixture.conversationId);
    expect(stored?.recordedByUserId).toBe(fixture.userId);
    expect(stored?.attribution).toBe("UNATTRIBUTED");
    expect(stored?.decisionRecordId).toBeNull();
  });

  it("2. persists lostReason, productSold, and notes exactly as given", async () => {
    const result = await recordConversationOutcome(
      fixture.businessId,
      fixture.conversationId,
      fixture.userId,
      { outcomeType: "SALE_LOST", lostReason: "PRECIO", productSold: undefined, notes: "El cliente encontró un precio menor." },
      db!,
    );

    expect(result.outcomeType).toBe("SALE_LOST");
    expect(result.lostReason).toBe("PRECIO");
    expect(result.notes).toBe("El cliente encontró un precio menor.");

    const stored = await db!.outcome.findUnique({ where: { id: result.id } });
    expect(stored?.lostReason).toBe("PRECIO");
    expect(stored?.notes).toBe("El cliente encontró un precio menor.");
  });

  it("3. supports NOT_AN_OPPORTUNITY as an outcomeType", async () => {
    const result = await recordConversationOutcome(
      fixture.businessId,
      fixture.conversationId,
      fixture.userId,
      { outcomeType: "NOT_AN_OPPORTUNITY", lostReason: undefined, productSold: undefined, notes: undefined },
      db!,
    );

    expect(result.outcomeType).toBe("NOT_AN_OPPORTUNITY");
  });

  it("4. recording multiple outcomes on the same conversation keeps every row (a history, never an upsert)", async () => {
    await recordConversationOutcome(
      fixture.businessId,
      fixture.conversationId,
      fixture.userId,
      { outcomeType: "FOLLOW_UP_SENT" as never, lostReason: undefined, productSold: undefined, notes: undefined },
      db!,
    );
    await recordConversationOutcome(
      fixture.businessId,
      fixture.conversationId,
      fixture.userId,
      { outcomeType: "SALE_CLOSED", lostReason: undefined, productSold: "Kit TRAVO", notes: undefined },
      db!,
    );

    const count = await db!.outcome.count({ where: { conversationId: fixture.conversationId } });
    expect(count).toBe(2);
  });

  it("5. links to a DecisionRecord with the given attribution, when both are provided", async () => {
    const decision = buildKoriDecision({ metadata: { ...buildKoriDecision().metadata, conversationId: fixture.conversationId } });
    const saved = await decisionRepo!.save({ businessId: fixture.businessId, decision });

    const result = await recordConversationOutcome(
      fixture.businessId,
      fixture.conversationId,
      fixture.userId,
      {
        outcomeType: "SALE_CLOSED",
        lostReason: undefined,
        productSold: undefined,
        notes: undefined,
        decisionRecordId: saved.id,
        attribution: "KORI_RECOMMENDATION",
      },
      db!,
    );

    expect(result.decisionRecordId).toBe(saved.id);
    expect(result.attribution).toBe("KORI_RECOMMENDATION");

    const stored = await db!.outcome.findUnique({ where: { id: result.id } });
    expect(stored?.decisionRecordId).toBe(saved.id);
    expect(stored?.attribution).toBe("KORI_RECOMMENDATION");
  });

  it("7. tenant isolation — an outcome recorded for one business never leaks into another business's count", async () => {
    const otherFixture = await createTestFixture(db!, "record-conversation-outcome-other");
    try {
      await recordConversationOutcome(
        fixture.businessId,
        fixture.conversationId,
        fixture.userId,
        { outcomeType: "SALE_CLOSED", lostReason: undefined, productSold: undefined, notes: undefined },
        db!,
      );

      const otherBusinessCount = await db!.outcome.count({ where: { businessId: otherFixture.businessId } });
      expect(otherBusinessCount).toBe(0);
    } finally {
      await cleanupTestFixture(db!, otherFixture);
    }
  });
});
