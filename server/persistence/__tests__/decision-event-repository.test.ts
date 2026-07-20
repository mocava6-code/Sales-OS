import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaDecisionEventRepository } from "../prisma/prisma-decision-event-repository";
import {
  cleanupTestFixture,
  createDecisionRecordFixture,
  createTestFixture,
  getTestPrisma,
  shouldRunDbTests,
  type TestFixture,
} from "./test-db";

describe.skipIf(!shouldRunDbTests)("PrismaDecisionEventRepository (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  const repo = db ? new PrismaDecisionEventRepository(db) : undefined;
  let fixture: TestFixture;
  let decisionRecordId: string;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "event");
    decisionRecordId = await createDecisionRecordFixture(db!, fixture);
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
  });

  it("appends an event and lists it back", async () => {
    const event = await repo!.append({ decisionRecordId, eventType: "PROPOSED", note: "auto-generated" });

    expect(event.id).toBeTruthy();
    expect(event.decisionRecordId).toBe(decisionRecordId);
    expect(event.eventType).toBe("PROPOSED");
    expect(event.note).toBe("auto-generated");
    expect(event.occurredAt).toBeInstanceOf(Date);

    const history = await repo!.listForDecision(decisionRecordId);
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(event.id);
  });

  it("is append-only and chronological across a full decision lifecycle, never aggregated", async () => {
    await repo!.append({ decisionRecordId, eventType: "PROPOSED", occurredAt: new Date("2026-07-18T12:00:00.000Z") });
    await repo!.append({ decisionRecordId, eventType: "APPROVED", occurredAt: new Date("2026-07-18T12:05:00.000Z") });
    await repo!.append({
      decisionRecordId,
      eventType: "CUSTOMER_REPLIED",
      occurredAt: new Date("2026-07-18T13:00:00.000Z"),
    });
    await repo!.append({
      decisionRecordId,
      eventType: "SALE_CLOSED",
      occurredAt: new Date("2026-07-19T09:00:00.000Z"),
    });

    const history = await repo!.listForDecision(decisionRecordId);

    expect(history.map((e) => e.eventType)).toEqual(["PROPOSED", "APPROVED", "CUSTOMER_REPLIED", "SALE_CLOSED"]);
  });

  it("defaults occurredAt to now when omitted, and note to null", async () => {
    const before = new Date();
    const event = await repo!.append({ decisionRecordId, eventType: "EXECUTED" });
    const after = new Date();

    expect(event.note).toBeNull();
    expect(event.occurredAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(event.occurredAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("supports the ADVISOR_OVERRIDDEN and KORI_OVERRIDDEN event types", async () => {
    const advisorOverridden = await repo!.append({ decisionRecordId, eventType: "ADVISOR_OVERRIDDEN" });
    const koriOverridden = await repo!.append({ decisionRecordId, eventType: "KORI_OVERRIDDEN" });

    expect(advisorOverridden.eventType).toBe("ADVISOR_OVERRIDDEN");
    expect(koriOverridden.eventType).toBe("KORI_OVERRIDDEN");
  });
});
