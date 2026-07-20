// Gated integration test proving the real analyzeConversationHandler —
// including the real loadAuthorizedConversation and withAnalysisRunLock,
// not fakes — works end to end against a real Postgres database (the
// isolated local sales_os_test instance; never the pilot DATABASE_URL).
// Skipped by default, exactly like every other RUN_DB_TESTS-gated test.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAIProvider } from "../../intelligence/testing/mock-ai-provider";
import { decisionProposal, minimalProviderResult } from "../../orchestration/__tests__/provider-fixtures";
import {
  cleanupTestFixture,
  createTestFixture,
  getTestPrisma,
  shouldRunDbTests,
  type TestFixture,
} from "../../persistence/__tests__/test-db";
import { PrismaTransactionRunner } from "../../persistence/prisma/prisma-transaction-runner";
import { loadAuthorizedConversation } from "../access-control";
import { withAnalysisRunLock } from "../analysis-run-lock";
import { analyzeConversationHandler } from "../decision-actions";
import { AnalysisInProgressError } from "../errors";
import { createFakeAuthContextResolver } from "../testing/fake-auth";

describe.skipIf(!shouldRunDbTests)(
  "analyzeConversationHandler — real Postgres, real access-control/lock (RUN_DB_TESTS=true)",
  () => {
    const db = shouldRunDbTests ? getTestPrisma() : undefined;
    let fixture: TestFixture;

    beforeEach(async () => {
      fixture = await createTestFixture(db!, "analyze-action");
      await db!.conversationEntry.create({
        data: {
          conversationId: fixture.conversationId,
          direction: "INBOUND",
          content: "Hola, tengo una consulta sobre un kit para mi Hilux 2022.",
          occurredAt: new Date(),
        },
      });
    });

    afterEach(async () => {
      await db!.conversationEntry.deleteMany({ where: { conversationId: fixture.conversationId } });
      await db!.conversationAnalysisRun.deleteMany({ where: { conversationId: fixture.conversationId } });
      await cleanupTestFixture(db!, fixture);
    });

    it("resolves the conversation, analyzes it, and returns persisted decisions using the real implementation", async () => {
      const resolver = createFakeAuthContextResolver({
        id: fixture.userId,
        businessId: fixture.businessId,
        role: "SALESPERSON",
      });
      const mock = createMockAIProvider({
        response: () => JSON.stringify(minimalProviderResult()),
        decisionReasoningResponse: () => JSON.stringify({ decisions: [decisionProposal("Decision A")] }),
      });

      const result = await analyzeConversationHandler(
        { conversationId: fixture.conversationId },
        {
          resolver,
          aiProvider: mock.provider,
          transactionRunner: new PrismaTransactionRunner(db!),
          loadConversation: (user, conversationId) => loadAuthorizedConversation(user, conversationId, db!),
          runWithAnalysisLock: (businessId, conversationId, work) =>
            withAnalysisRunLock(businessId, conversationId, work, db!),
        },
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.decisions).toHaveLength(1);
        expect(result.data.conversationSnapshotId).toBeTruthy();
      }

      const persistedRuns = await db!.conversationAnalysisRun.findMany({
        where: { conversationId: fixture.conversationId },
      });
      expect(persistedRuns).toHaveLength(0); // released after completion
    });

    it("returns NOT_FOUND for a conversation from another business, via the real Prisma-backed lookup", async () => {
      const otherFixture = await createTestFixture(db!, "analyze-action-other");
      const resolver = createFakeAuthContextResolver({
        id: otherFixture.userId,
        businessId: otherFixture.businessId,
        role: "SALESPERSON",
      });
      const mock = createMockAIProvider({ response: () => JSON.stringify(minimalProviderResult()) });

      const result = await analyzeConversationHandler(
        { conversationId: fixture.conversationId }, // belongs to `fixture`'s business, not `otherFixture`'s
        {
          resolver,
          aiProvider: mock.provider,
          transactionRunner: new PrismaTransactionRunner(db!),
          loadConversation: (user, conversationId) => loadAuthorizedConversation(user, conversationId, db!),
          runWithAnalysisLock: (businessId, conversationId, work) =>
            withAnalysisRunLock(businessId, conversationId, work, db!),
        },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");

      await cleanupTestFixture(db!, otherFixture);
    });

    it("prevents duplicate concurrent analysis of the same conversation via the real unique-constraint guard", async () => {
      let releaseFirst!: () => void;
      const firstIsRunning = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let firstStarted!: () => void;
      const firstStartedPromise = new Promise<void>((resolve) => {
        firstStarted = resolve;
      });

      const firstRun = withAnalysisRunLock(
        fixture.businessId,
        fixture.conversationId,
        async () => {
          firstStarted();
          await firstIsRunning;
          return "first done";
        },
        db!,
      );

      await firstStartedPromise;

      await expect(
        withAnalysisRunLock(fixture.businessId, fixture.conversationId, async () => "second done", db!),
      ).rejects.toBeInstanceOf(AnalysisInProgressError);

      releaseFirst();
      await expect(firstRun).resolves.toBe("first done");

      const persistedRuns = await db!.conversationAnalysisRun.findMany({
        where: { conversationId: fixture.conversationId },
      });
      expect(persistedRuns).toHaveLength(0); // released once the first call finished
    });
  },
);
