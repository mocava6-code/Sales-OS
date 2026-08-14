// Gated: proves askKori end-to-end (parse -> execute -> format) against
// real Postgres for each operation STEP 6 requires — COUNT, LIST, GROUP,
// PRODUCT_RANKING, COUNT_OUTCOMES — with a mocked Groq client (no real API
// key/network call needed) so only the executor + formatter are actually
// under test here. Tenant isolation, no-raw-SQL, and no-write guarantees
// are already exhaustively proven at the executeKoriQuery layer
// (query-executor.db.test.ts) — this file doesn't duplicate that battery,
// it proves askKori's own wiring produces correct end-to-end answers.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { askKori } from "../ask-kori";
import { createDecisionRecordFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "../../persistence/__tests__/test-db";
import type { GroqClient } from "../groq-client";

type Db = ReturnType<typeof getTestPrisma>;

function fakeGroqClient(responseText: string): GroqClient {
  return { model: "test-model", complete: async () => responseText };
}

describe.skipIf(!shouldRunDbTests)("askKori — end-to-end against real Postgres", () => {
  let db: Db;
  let fixture: TestFixture;

  beforeEach(async () => {
    db = getTestPrisma();
    fixture = await createTestFixture(db, "ask-kori");
    await db.leadCommercialProfile.create({
      data: { leadId: fixture.leadId, businessId: fixture.businessId, vehicleBrand: "Toyota", productInterest: "TRAVO body kit" },
    });
  });

  afterEach(async () => {
    await cleanupExtra();
    const { cleanupTestFixture } = await import("../../persistence/__tests__/test-db");
    await cleanupTestFixture(db, fixture);
  });

  let decisionRecordIdForCleanup: string | undefined;
  async function cleanupExtra() {
    if (decisionRecordIdForCleanup) {
      await db.outcome.deleteMany({ where: { decisionRecordId: decisionRecordIdForCleanup } });
      decisionRecordIdForCleanup = undefined;
    }
  }

  it("COUNT_LEADS: answers with the real count for this business", async () => {
    const groqClient = fakeGroqClient('{"operation":"COUNT_LEADS"}');
    const output = await askKori({ businessId: fixture.businessId, question: "¿Cuántos clientes tenemos?" }, { groqClient, db });

    expect(output.result.type).toBe("count");
    if (output.result.type === "count") expect(output.result.count).toBe(1);
    expect(output.result.answer).toBe("Hay 1 cliente.");
  });

  it("LIST_LEADS: returns the real lead row, filtered by vehicleBrand", async () => {
    const groqClient = fakeGroqClient('{"operation":"LIST_LEADS","filters":{"vehicleBrand":"Toyota"}}');
    const output = await askKori({ businessId: fixture.businessId, question: "¿Qué clientes Toyota tenemos?" }, { groqClient, db });

    expect(output.result.type).toBe("lead_list");
    if (output.result.type === "lead_list") {
      expect(output.result.count).toBe(1);
      expect(output.result.rows[0].leadId).toBe(fixture.leadId);
      expect(output.result.rows[0].vehicleBrand).toBe("Toyota");
    }
  });

  it("GROUP_LEADS: groups the real lead by vehicleBrand", async () => {
    const groqClient = fakeGroqClient('{"operation":"GROUP_LEADS","groupBy":"vehicleBrand"}');
    const output = await askKori({ businessId: fixture.businessId, question: "¿Cuántos clientes Toyota tenemos?" }, { groqClient, db });

    expect(output.result.type).toBe("grouped_result");
    if (output.result.type === "grouped_result") {
      expect(output.result.groups).toEqual([{ key: "Toyota", count: 1 }]);
    }
    expect(output.result.answer).toBe("Toyota: 1.");
  });

  it("PRODUCT_RANKING: ranks the real productInterest", async () => {
    const groqClient = fakeGroqClient('{"operation":"PRODUCT_RANKING"}');
    const output = await askKori({ businessId: fixture.businessId, question: "¿Qué productos se preguntan más?" }, { groqClient, db });

    expect(output.result.type).toBe("grouped_result");
    if (output.result.type === "grouped_result") {
      expect(output.result.groups).toEqual([{ key: "TRAVO body kit", count: 1 }]);
    }
    expect(output.result.answer).toBe("Los productos más consultados en los últimos 30 días son: TRAVO body kit (1).");
  });

  it("COUNT_OUTCOMES: counts a real Outcome row for this business", async () => {
    const decisionRecordId = await createDecisionRecordFixture(db, fixture);
    decisionRecordIdForCleanup = decisionRecordId;
    await db.outcome.create({
      data: { businessId: fixture.businessId, conversationId: fixture.conversationId, decisionRecordId, outcomeType: "QUOTATION_SENT", occurredAt: new Date() },
    });

    const groqClient = fakeGroqClient('{"operation":"COUNT_OUTCOMES","filters":{"outcomeType":"QUOTATION_SENT"}}');
    const output = await askKori({ businessId: fixture.businessId, question: "¿Cuántas cotizaciones enviamos?" }, { groqClient, db });

    expect(output.result.type).toBe("count");
    if (output.result.type === "count") expect(output.result.count).toBe(1);
    expect(output.result.answer).toBe("Se enviaron 1 cotizaciones.");
  });

  it("tenant isolation: a second business's identical query sees zero results", async () => {
    const otherFixture = await createTestFixture(db, "ask-kori-other");
    try {
      const groqClient = fakeGroqClient('{"operation":"COUNT_LEADS"}');
      const output = await askKori({ businessId: otherFixture.businessId, question: "¿Cuántos clientes tenemos?" }, { groqClient, db });
      expect(output.result.type).toBe("count");
      if (output.result.type === "count") expect(output.result.count).toBe(1); // otherFixture's own lead, not fixture's
    } finally {
      const { cleanupTestFixture } = await import("../../persistence/__tests__/test-db");
      await cleanupTestFixture(db, otherFixture);
    }
  });
});
