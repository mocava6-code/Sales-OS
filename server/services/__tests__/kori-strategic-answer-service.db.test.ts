// Gated: proves answerStrategicQuestion wires the right Business Insights
// Engine calls together per intent against real Postgres. The answer text
// itself (templates, thresholds) is already covered exhaustively by the
// pure-function unit tests in this directory — this file only proves the
// per-intent dispatch fetches real data correctly.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerStrategicQuestion } from "../kori-strategic-answer-service";
import { cleanupTestFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "../../persistence/__tests__/test-db";

describe.skipIf(!shouldRunDbTests)("answerStrategicQuestion (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: TestFixture;
  let now: Date;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "strategic-answer");
    now = new Date();
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
  });

  it("TOP_OPPORTUNITY_PRODUCT: gives an honest no-data answer for a business with no products yet", async () => {
    const answer = await answerStrategicQuestion(fixture.businessId, "TOP_OPPORTUNITY_PRODUCT", now, db!);
    expect(answer).toBe("Todavía no hay suficiente información sobre productos y resultados este mes para recomendar uno en particular.");
  });

  it("MAIN_WEAKNESS: reflects a real recorded loss with a dominant reason", async () => {
    await db!.outcome.createMany({
      data: [
        { businessId: fixture.businessId, conversationId: fixture.conversationId, outcomeType: "SALE_LOST", lostReason: "PRECIO", occurredAt: now, attribution: "UNATTRIBUTED" },
        { businessId: fixture.businessId, conversationId: fixture.conversationId, outcomeType: "SALE_LOST", lostReason: "PRECIO", occurredAt: now, attribution: "UNATTRIBUTED" },
      ],
    });

    const answer = await answerStrategicQuestion(fixture.businessId, "MAIN_WEAKNESS", now, db!);

    expect(answer).toContain("precio");
  });

  it("WHERE_TO_INVEST: gives an honest no-data answer for a business with no products yet", async () => {
    const answer = await answerStrategicQuestion(fixture.businessId, "WHERE_TO_INVEST", now, db!);
    expect(answer).toBe("Todavía no hay suficiente información para recomendar dónde invertir.");
  });

  it("scopes every intent to the requesting business only (tenant isolation)", async () => {
    const otherFixture = await createTestFixture(db!, "strategic-answer-other");
    try {
      await db!.outcome.createMany({
        data: [
          { businessId: otherFixture.businessId, conversationId: otherFixture.conversationId, outcomeType: "SALE_LOST", lostReason: "PRECIO", occurredAt: now, attribution: "UNATTRIBUTED" },
          { businessId: otherFixture.businessId, conversationId: otherFixture.conversationId, outcomeType: "SALE_LOST", lostReason: "PRECIO", occurredAt: now, attribution: "UNATTRIBUTED" },
        ],
      });

      const answer = await answerStrategicQuestion(fixture.businessId, "MAIN_WEAKNESS", now, db!);

      expect(answer).not.toContain("precio");
      expect(answer).toBe("No se detectó un problema dominante todavía — los resultados de este mes están relativamente parejos.");
    } finally {
      await cleanupTestFixture(db!, otherFixture);
    }
  });
});
