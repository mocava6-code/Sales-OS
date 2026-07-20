import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaConversationSnapshotRepository } from "../prisma/prisma-conversation-snapshot-repository";
import { PrismaDecisionRepository } from "../prisma/prisma-decision-repository";
import { buildConversationIntelligenceResult, buildKoriDecision } from "../../intelligence/testing/fixtures";
import { cleanupTestFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "./test-db";

describe.skipIf(!shouldRunDbTests)("PrismaDecisionRepository (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  const decisionRepo = db ? new PrismaDecisionRepository(db) : undefined;
  const snapshotRepo = db ? new PrismaConversationSnapshotRepository(db) : undefined;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "decision");
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
  });

  it("persists and round-trips a full KoriDecision", async () => {
    const decision = buildKoriDecision({
      metadata: {
        engineSchemaVersion: 1,
        promptVersion: "kori-decision-v1",
        aiProvider: "anthropic",
        modelName: "claude-test",
        decidedAt: new Date("2026-07-18T12:05:00.000Z"),
        conversationId: fixture.conversationId,
        sourceConversationIntelligenceGeneratedAt: new Date("2026-07-18T12:00:00.000Z"),
      },
    });

    const saved = await decisionRepo!.save({ businessId: fixture.businessId, decision });

    expect(saved.id).toBeTruthy();
    expect(saved.businessId).toBe(fixture.businessId);
    expect(saved.conversationId).toBe(fixture.conversationId);
    expect(saved.conversationSnapshotId).toBeNull();
    expect(saved.decision).toEqual(decision);
  });

  it("keeps the engine's own deterministic id (KoriDecision.id) distinct from the persistence row id", async () => {
    const decision = buildKoriDecision({
      id: "decision_abc123",
      metadata: { ...buildKoriDecision().metadata, conversationId: fixture.conversationId },
    });

    const saved = await decisionRepo!.save({ businessId: fixture.businessId, decision });

    expect(saved.decision.id).toBe("decision_abc123");
    expect(saved.id).not.toBe("decision_abc123");
  });

  it("links to the ConversationSnapshot that informed it when given one", async () => {
    const snapshot = await snapshotRepo!.save({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      result: buildConversationIntelligenceResult(),
    });
    const decision = buildKoriDecision({
      metadata: { ...buildKoriDecision().metadata, conversationId: fixture.conversationId },
    });

    const saved = await decisionRepo!.save({
      businessId: fixture.businessId,
      conversationSnapshotId: snapshot.id,
      decision,
    });

    expect(saved.conversationSnapshotId).toBe(snapshot.id);
  });

  it("persists version metadata exactly", async () => {
    const decision = buildKoriDecision({
      metadata: {
        engineSchemaVersion: 3,
        promptVersion: "kori-decision-v3-experimental",
        aiProvider: "anthropic",
        modelName: "claude-opus-4-8",
        decidedAt: new Date("2026-07-19T09:00:00.000Z"),
        conversationId: fixture.conversationId,
        sourceConversationIntelligenceGeneratedAt: undefined,
      },
    });

    const saved = await decisionRepo!.save({ businessId: fixture.businessId, decision });

    expect(saved.decision.metadata).toEqual(decision.metadata);
  });

  it("is append-only: two engine runs on the same conversation both persist, even with the same engine decision id", async () => {
    const base = buildKoriDecision({
      id: "decision_repeat",
      metadata: { ...buildKoriDecision().metadata, conversationId: fixture.conversationId },
    });

    const first = await decisionRepo!.save({ businessId: fixture.businessId, decision: base });
    const second = await decisionRepo!.save({ businessId: fixture.businessId, decision: base });

    expect(first.id).not.toBe(second.id);

    const history = await decisionRepo!.listForConversation(fixture.conversationId);
    expect(history.map((d) => d.id)).toEqual([first.id, second.id]);
    expect(history.every((d) => d.decision.id === "decision_repeat")).toBe(true);
  });

  it("findById returns null for an unknown id", async () => {
    const found = await decisionRepo!.findById("00000000-0000-0000-0000-000000000000");
    expect(found).toBeNull();
  });

  it("updateStatus mutates only the status field", async () => {
    const decision = buildKoriDecision({
      status: "PROPOSED",
      metadata: { ...buildKoriDecision().metadata, conversationId: fixture.conversationId },
    });
    const saved = await decisionRepo!.save({ businessId: fixture.businessId, decision });

    const updated = await decisionRepo!.updateStatus(saved.id, "APPROVED");

    expect(updated.decision.status).toBe("APPROVED");
    expect(updated.decision.recommendation).toBe(decision.recommendation);
    expect(updated.decision.evidence).toEqual(decision.evidence);
    expect(updated.createdAt).toEqual(saved.createdAt);
  });
});
