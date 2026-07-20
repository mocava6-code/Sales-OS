import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaAdvisorActionRepository } from "../prisma/prisma-advisor-action-repository";
import {
  cleanupTestFixture,
  createDecisionRecordFixture,
  createTestFixture,
  getTestPrisma,
  shouldRunDbTests,
  type TestFixture,
} from "./test-db";

describe.skipIf(!shouldRunDbTests)("PrismaAdvisorActionRepository (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  const repo = db ? new PrismaAdvisorActionRepository(db) : undefined;
  let fixture: TestFixture;
  let decisionRecordId: string;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "advisor-action");
    decisionRecordId = await createDecisionRecordFixture(db!, fixture);
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
  });

  it("records what the advisor actually did, including the advisor and notes", async () => {
    const action = await repo!.record({
      decisionRecordId,
      actionType: "PARTIALLY_FOLLOWED_RECOMMENDATION",
      advisorUserId: fixture.userId,
      notes: "Sent a shorter message than recommended, kept the core ask.",
    });

    expect(action.id).toBeTruthy();
    expect(action.decisionRecordId).toBe(decisionRecordId);
    expect(action.actionType).toBe("PARTIALLY_FOLLOWED_RECOMMENDATION");
    expect(action.advisorUserId).toBe(fixture.userId);
    expect(action.notes).toBe("Sent a shorter message than recommended, kept the core ask.");
  });

  it("defaults advisorUserId and notes to null when omitted", async () => {
    const action = await repo!.record({ decisionRecordId, actionType: "CUSTOM_ACTION" });

    expect(action.advisorUserId).toBeNull();
    expect(action.notes).toBeNull();
  });

  it("is append-only: a decision can accumulate more than one advisor action over time", async () => {
    const first = await repo!.record({ decisionRecordId, actionType: "IGNORED_RECOMMENDATION" });
    const second = await repo!.record({ decisionRecordId, actionType: "CUSTOM_ACTION", notes: "Called instead." });

    const history = await repo!.listForDecision(decisionRecordId);

    expect(history.map((a) => a.id)).toEqual([first.id, second.id]);
    expect(history.map((a) => a.actionType)).toEqual(["IGNORED_RECOMMENDATION", "CUSTOM_ACTION"]);
  });

  it("supports FOLLOWED_RECOMMENDATION", async () => {
    const action = await repo!.record({ decisionRecordId, actionType: "FOLLOWED_RECOMMENDATION" });
    expect(action.actionType).toBe("FOLLOWED_RECOMMENDATION");
  });
});
