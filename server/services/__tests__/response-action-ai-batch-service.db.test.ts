// Gated: proves runResponseActionAIBatch against real Postgres — UNCERTAIN
// conversation selection, persist=false (classify-only, no write) vs.
// persist=true (backfill, writes via the already-tested
// projectConversationActionState), rate-limit handling (stops the batch,
// never retries in a loop), tenant isolation, and the
// no-AI-provider-configured graceful path.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runResponseActionAIBatch } from "../response-action-ai-batch-service";
import { createMockAIProvider } from "../../intelligence/testing/mock-ai-provider";
import { KoriProviderRateLimitedError } from "../../kori/errors";
import { cleanupTestFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "../../persistence/__tests__/test-db";

// evidenceEntryIds must reference a real entry id for the AI classifier's
// grounding check to accept a non-UNCERTAIN result — see ai-classifier.ts's
// hasRequiredEvidence rule.
function replyRequiredJson(evidenceEntryId: string, reasonCode = "CUSTOMER_QUESTION") {
  return JSON.stringify({
    actionState: "REPLY_REQUIRED",
    reasonCode,
    confidence: 0.8,
    reasoning: "AI-assessed as needing a reply.",
    evidenceEntryIds: [evidenceEntryId],
    recommendedAction: null,
  });
}

describe.skipIf(!shouldRunDbTests)("runResponseActionAIBatch (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: TestFixture;
  const extraConversationIds: string[] = [];

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "response-action-ai-batch");
    extraConversationIds.length = 0;
    // The base fixture's own conversation has zero entries, which
    // deterministically resolves to UNCERTAIN too (see
    // classifyDeterministically's INCONCLUSIVE-on-empty-entries rule) —
    // give it an unambiguous closing message so it resolves to
    // NO_ACTION_REQUIRED and never pollutes this file's UNCERTAIN-pool
    // assertions.
    await db!.conversationEntry.create({ data: { conversationId: fixture.conversationId, direction: "INBOUND", content: "Gracias", occurredAt: new Date() } });
  });

  afterEach(async () => {
    for (const conversationId of extraConversationIds) {
      await db!.conversationActionState.deleteMany({ where: { conversationId } });
      await db!.conversationEntry.deleteMany({ where: { conversationId } });
      await db!.conversation.delete({ where: { id: conversationId } });
    }
    await cleanupTestFixture(db!, fixture);
    await db!.conversationActionState.deleteMany({ where: { businessId: fixture.businessId } });
  });

  /** An UNCERTAIN-by-construction conversation: off-topic content the deterministic classifier can't resolve. */
  async function makeUncertainConversation(businessId: string, leadId: string, userId: string, content: string): Promise<{ conversationId: string; entryId: string }> {
    const conversation = await db!.conversation.create({
      data: { businessId, leadId, source: "MANUAL_PASTE", status: "NEEDS_REPLY", lastEntryAt: new Date(), lastEntryDirection: "INBOUND", createdByUserId: userId },
    });
    const entry = await db!.conversationEntry.create({ data: { conversationId: conversation.id, direction: "INBOUND", content, occurredAt: new Date() } });
    extraConversationIds.push(conversation.id);
    return { conversationId: conversation.id, entryId: entry.id };
  }

  it("returns a graceful, empty-but-informative result when no AI provider is configured — never scans or throws", async () => {
    await makeUncertainConversation(fixture.businessId, fixture.leadId, fixture.userId, "Que te llevo");

    const result = await runResponseActionAIBatch({ businessId: fixture.businessId, batchSize: 5, persist: false, aiProvider: undefined }, db!);

    expect(result.aiProviderConfigured).toBe(false);
    expect(result.scanned).toBe(0);
    expect(result.processed).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("persist=false classifies UNCERTAIN conversations via AI but writes nothing", async () => {
    const { conversationId, entryId } = await makeUncertainConversation(fixture.businessId, fixture.leadId, fixture.userId, "Que te llevo");
    const mock = createMockAIProvider({ response: replyRequiredJson(entryId) });

    const result = await runResponseActionAIBatch({ businessId: fixture.businessId, batchSize: 5, persist: false, aiProvider: mock.provider }, db!);

    expect(result.scanned).toBe(1);
    expect(result.processed).toBe(1);
    expect(result.items[0]).toMatchObject({ conversationId, after: "REPLY_REQUIRED", persisted: false });
    expect(mock.getCallCount()).toBe(1);

    const row = await db!.conversationActionState.findUnique({ where: { conversationId } });
    expect(row).toBeNull();
  });

  it("persist=true classifies AND persists via projectConversationActionState (idempotent)", async () => {
    const { conversationId, entryId } = await makeUncertainConversation(fixture.businessId, fixture.leadId, fixture.userId, "Que te llevo");
    const mock = createMockAIProvider({ response: replyRequiredJson(entryId) });

    const result = await runResponseActionAIBatch({ businessId: fixture.businessId, batchSize: 5, persist: true, aiProvider: mock.provider }, db!);

    expect(result.processed).toBe(1);
    expect(result.items[0]).toMatchObject({ conversationId, after: "REPLY_REQUIRED", persisted: true });

    const row = await db!.conversationActionState.findUnique({ where: { conversationId } });
    expect(row?.actionState).toBe("REPLY_REQUIRED");
    expect(row?.source).toBe("AI");
  });

  it("never returns raw message content or reasoning text in the item results", async () => {
    const secretContent = "el cliente vive en la calle secreta 123";
    const { entryId } = await makeUncertainConversation(fixture.businessId, fixture.leadId, fixture.userId, secretContent);
    const mock = createMockAIProvider({ response: replyRequiredJson(entryId) });

    const result = await runResponseActionAIBatch({ businessId: fixture.businessId, batchSize: 5, persist: false, aiProvider: mock.provider }, db!);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secretContent);
    expect(serialized).not.toContain("AI-assessed as needing a reply"); // reasoning text
  });

  it("stops the batch on a rate-limit error and reports the remaining conversations as skipped, never retrying in a loop", async () => {
    const first = await makeUncertainConversation(fixture.businessId, fixture.leadId, fixture.userId, "Que te llevo");
    await makeUncertainConversation(fixture.businessId, fixture.leadId, fixture.userId, "Ponte la camiseta");

    let calls = 0;
    const mock = createMockAIProvider({
      response: () => {
        calls++;
        if (calls === 1) return replyRequiredJson(first.entryId);
        throw new KoriProviderRateLimitedError("Groq rate limit exceeded (429).");
      },
    });

    const result = await runResponseActionAIBatch({ businessId: fixture.businessId, batchSize: 5, persist: false, aiProvider: mock.provider }, db!);

    expect(result.scanned).toBe(2);
    expect(result.processed).toBe(1);
    expect(result.skippedRateLimited).toBe(1);
    expect(mock.getCallCount()).toBe(2); // never retried beyond the one that hit 429
  });

  it("respects the batchSize bound even when more UNCERTAIN conversations exist", async () => {
    const first = await makeUncertainConversation(fixture.businessId, fixture.leadId, fixture.userId, "Que te llevo");
    await makeUncertainConversation(fixture.businessId, fixture.leadId, fixture.userId, "Ponte la camiseta");
    await makeUncertainConversation(fixture.businessId, fixture.leadId, fixture.userId, "Elige y ya");
    const mock = createMockAIProvider({ response: replyRequiredJson(first.entryId) });

    const result = await runResponseActionAIBatch({ businessId: fixture.businessId, batchSize: 2, persist: false, aiProvider: mock.provider }, db!);

    expect(result.scanned).toBe(2);
  });

  it("tenant isolation: a conversation belonging to a different business is never scanned", async () => {
    const other = await createTestFixture(db!, "response-action-ai-batch-other");
    const otherConversation = await db!.conversation.create({
      data: { businessId: other.businessId, leadId: other.leadId, source: "MANUAL_PASTE", status: "NEEDS_REPLY", lastEntryAt: new Date(), lastEntryDirection: "INBOUND", createdByUserId: other.userId },
    });
    try {
      const otherEntry = await db!.conversationEntry.create({ data: { conversationId: otherConversation.id, direction: "INBOUND", content: "Que te llevo", occurredAt: new Date() } });

      const mock = createMockAIProvider({ response: replyRequiredJson(otherEntry.id) });
      const result = await runResponseActionAIBatch({ businessId: fixture.businessId, batchSize: 5, persist: false, aiProvider: mock.provider }, db!);

      expect(result.items.some((item) => item.conversationId === otherConversation.id)).toBe(false);
    } finally {
      await db!.conversationActionState.deleteMany({ where: { conversationId: otherConversation.id } });
      await db!.conversationEntry.deleteMany({ where: { conversationId: otherConversation.id } });
      await db!.conversation.delete({ where: { id: otherConversation.id } });
      await cleanupTestFixture(db!, other);
    }
  });

  it("a conversation that resolves deterministically (not UNCERTAIN) is never selected — AI is never spent on it", async () => {
    await makeUncertainConversation(fixture.businessId, fixture.leadId, fixture.userId, "¿Cuánto cuesta el kit?"); // PRICE_REQUEST — deterministic
    const mock = createMockAIProvider({ response: "{}" });

    const result = await runResponseActionAIBatch({ businessId: fixture.businessId, batchSize: 5, persist: false, aiProvider: mock.provider }, db!);

    expect(result.scanned).toBe(0);
    expect(mock.getCallCount()).toBe(0);
  });
});
