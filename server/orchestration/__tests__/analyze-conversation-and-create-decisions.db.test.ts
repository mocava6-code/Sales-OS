// Gated integration test proving the full orchestration transaction works
// against a real Postgres database (the isolated local sales_os_test
// instance — never the pilot DATABASE_URL; see
// server/persistence/__tests__/test-db.ts). Skipped by default, exactly
// like every other RUN_DB_TESTS-gated test in this codebase.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeConversation } from "../../intelligence/analyze-conversation";
import { createMockAIProvider } from "../../intelligence/testing/mock-ai-provider";
import {
  cleanupTestFixture,
  createTestFixture,
  getTestPrisma,
  shouldRunDbTests,
  type TestFixture,
} from "../../persistence/__tests__/test-db";
import { PrismaTransactionRunner } from "../../persistence/prisma/prisma-transaction-runner";
import { analyzeConversationAndCreateDecisions } from "../analyze-conversation-and-create-decisions";
import { OrchestrationTransactionError } from "../errors";
import { decisionProposal, minimalProviderResult } from "./provider-fixtures";

describe.skipIf(!shouldRunDbTests)(
  "analyzeConversationAndCreateDecisions — real Postgres transaction (RUN_DB_TESTS=true)",
  () => {
    const db = shouldRunDbTests ? getTestPrisma() : undefined;
    const runner = db ? new PrismaTransactionRunner(db) : undefined;
    let fixture: TestFixture;

    beforeEach(async () => {
      fixture = await createTestFixture(db!, "orchestration");
    });

    afterEach(async () => {
      await cleanupTestFixture(db!, fixture);
    });

    it("commits the snapshot, every decision, and every PROPOSED event atomically", async () => {
      const mock = createMockAIProvider({
        response: () => JSON.stringify(minimalProviderResult()),
        decisionReasoningResponse: () =>
          JSON.stringify({ decisions: [decisionProposal("Decision A"), decisionProposal("Decision B")] }),
      });

      const result = await analyzeConversationAndCreateDecisions(
        {
          businessId: fixture.businessId,
          conversationId: fixture.conversationId,
          conversationIntelligenceInput: { tenantId: fixture.businessId, channel: "manual", rawText: "Hola, una consulta." },
        },
        { aiProvider: mock.provider, transactionRunner: runner! },
      );

      expect(result.decisions).toHaveLength(2);
      expect(result.events).toHaveLength(2);

      const [persistedSnapshots, persistedDecisions, persistedEvents] = await Promise.all([
        db!.conversationSnapshot.findMany({ where: { conversationId: fixture.conversationId } }),
        db!.decisionRecord.findMany({ where: { conversationId: fixture.conversationId } }),
        db!.decisionEvent.findMany({ where: { decisionRecord: { conversationId: fixture.conversationId } } }),
      ]);

      expect(persistedSnapshots).toHaveLength(1);
      expect(persistedDecisions).toHaveLength(2);
      expect(persistedEvents).toHaveLength(2);
      expect(persistedEvents.every((e) => e.eventType === "PROPOSED")).toBe(true);
      expect(persistedDecisions.every((d) => d.conversationSnapshotId === persistedSnapshots[0].id)).toBe(true);
    });

    it("rolls back every write against real Postgres if a later step in the transaction fails", async () => {
      const mock = createMockAIProvider({ response: () => JSON.stringify(minimalProviderResult()) });
      const conversationIntelligence = await analyzeConversation(
        { tenantId: fixture.businessId, channel: "manual", rawText: "Hola." },
        { aiProvider: mock.provider },
      );

      await expect(
        runner!.runInTransaction(async (uow) => {
          await uow.conversationSnapshots.save({
            businessId: fixture.businessId,
            conversationId: fixture.conversationId,
            result: conversationIntelligence,
          });
          throw new Error("simulated failure after the snapshot write");
        }),
      ).rejects.toThrow("simulated failure after the snapshot write");

      const persistedSnapshots = await db!.conversationSnapshot.findMany({
        where: { conversationId: fixture.conversationId },
      });
      expect(persistedSnapshots).toHaveLength(0);
    });

    it("wraps an unexpected persistence failure into OrchestrationTransactionError and leaves no partial memory", async () => {
      const mock = createMockAIProvider({
        response: () => JSON.stringify(minimalProviderResult()),
        decisionReasoningResponse: () => JSON.stringify({ decisions: [decisionProposal("Decision A")] }),
      });

      await expect(
        analyzeConversationAndCreateDecisions(
          {
            businessId: fixture.businessId,
            // A conversationId that doesn't exist violates the ConversationSnapshot/DecisionRecord FK
            // constraint — a real, unexpected persistence failure, not a deliberate orchestration error.
            conversationId: "00000000-0000-0000-0000-000000000000",
            conversationIntelligenceInput: { tenantId: fixture.businessId, channel: "manual", rawText: "Hola." },
          },
          { aiProvider: mock.provider, transactionRunner: runner! },
        ),
      ).rejects.toBeInstanceOf(OrchestrationTransactionError);

      const persistedSnapshots = await db!.conversationSnapshot.findMany({
        where: { conversationId: fixture.conversationId },
      });
      expect(persistedSnapshots).toHaveLength(0);
    });
  },
);
