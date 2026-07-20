import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaConversationSnapshotRepository } from "../prisma/prisma-conversation-snapshot-repository";
import { buildConversationIntelligenceResult } from "../../intelligence/testing/fixtures";
import { cleanupTestFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "./test-db";

describe.skipIf(!shouldRunDbTests)("PrismaConversationSnapshotRepository (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  const repo = db ? new PrismaConversationSnapshotRepository(db) : undefined;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "snapshot");
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
  });

  it("persists and round-trips the full ConversationIntelligenceResult", async () => {
    const result = buildConversationIntelligenceResult();

    const saved = await repo!.save({ businessId: fixture.businessId, conversationId: fixture.conversationId, result });

    expect(saved.id).toBeTruthy();
    expect(saved.businessId).toBe(fixture.businessId);
    expect(saved.conversationId).toBe(fixture.conversationId);
    expect(saved.createdAt).toBeInstanceOf(Date);
    expect(saved.result).toEqual(result);
  });

  it("persists version metadata exactly and never lets it be inferred/defaulted", async () => {
    const result = buildConversationIntelligenceResult({
      metadata: {
        engineSchemaVersion: 7,
        promptVersion: "kori-cie-v7-experimental",
        modelProvider: "anthropic",
        modelName: "claude-opus-4-8",
        analyzedAt: new Date("2026-07-19T08:30:00.000Z"),
      },
    });

    const saved = await repo!.save({ businessId: fixture.businessId, conversationId: fixture.conversationId, result });

    expect(saved.result.metadata).toEqual(result.metadata);
  });

  it("round-trips a null draftResponse and a populated one", async () => {
    const withNull = await repo!.save({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      result: buildConversationIntelligenceResult({ draftResponse: null }),
    });
    expect(withNull.result.draftResponse).toBeNull();

    const withDraft = await repo!.save({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      result: buildConversationIntelligenceResult({
        draftResponse: { text: "Hola, ¿me confirmas el año exacto de tu Hilux?", evidence: [] },
      }),
    });
    expect(withDraft.result.draftResponse).toEqual({
      text: "Hola, ¿me confirmas el año exacto de tu Hilux?",
      evidence: [],
    });
  });

  it("is append-only: re-analyzing the same conversation creates a new row, never overwrites the old one", async () => {
    const first = await repo!.save({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      result: buildConversationIntelligenceResult({ overallConfidence: 0.4 }),
    });
    const second = await repo!.save({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      result: buildConversationIntelligenceResult({ overallConfidence: 0.9 }),
    });

    const history = await repo!.listForConversation(fixture.conversationId);

    expect(history.map((s) => s.id)).toEqual([first.id, second.id]);
    expect(history[0].result.overallConfidence).toBe(0.4);
    expect(history[1].result.overallConfidence).toBe(0.9);
  });

  it("findLatestForConversation returns the most recently created snapshot", async () => {
    await repo!.save({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      result: buildConversationIntelligenceResult({ overallConfidence: 0.4 }),
    });
    const second = await repo!.save({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      result: buildConversationIntelligenceResult({ overallConfidence: 0.9 }),
    });

    const latest = await repo!.findLatestForConversation(fixture.conversationId);

    expect(latest?.id).toBe(second.id);
    expect(latest?.result.overallConfidence).toBe(0.9);
  });

  it("findLatestForConversation returns null when no snapshot exists yet", async () => {
    const latest = await repo!.findLatestForConversation(fixture.conversationId);
    expect(latest).toBeNull();
  });
});
