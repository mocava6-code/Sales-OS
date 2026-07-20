import { describe, expect, it } from "vitest";
import { createMockAIProvider } from "../../intelligence/testing/mock-ai-provider";
import type { TransactionRunner } from "../../persistence/unit-of-work";
import { analyzeConversationAndCreateDecisions } from "../analyze-conversation-and-create-decisions";
import { ConversationAnalysisFailedError, DecisionGenerationFailedError, OrchestrationTransactionError } from "../errors";
import type { AnalyzeConversationAndCreateDecisionsInput } from "../types";
import { createFakeTransactionRunner } from "./fakes";
import { decisionProposal, minimalProviderResult } from "./provider-fixtures";

function baseInput(
  overrides: Partial<AnalyzeConversationAndCreateDecisionsInput> = {},
): AnalyzeConversationAndCreateDecisionsInput {
  return {
    businessId: "biz-1",
    conversationId: "conv-1",
    conversationIntelligenceInput: { tenantId: "biz-1", channel: "manual", rawText: "Hola, tengo una consulta." },
    ...overrides,
  };
}

function mockAI(decisionCount = 1) {
  return createMockAIProvider({
    response: () => JSON.stringify(minimalProviderResult()),
    decisionReasoningResponse: () =>
      JSON.stringify({
        decisions: Array.from({ length: decisionCount }, (_, i) => decisionProposal(`Decision ${i + 1}`)),
      }),
  });
}

describe("analyzeConversationAndCreateDecisions — success paths", () => {
  it("1. persists a snapshot, one decision, and one PROPOSED event", async () => {
    const mock = mockAI(1);
    const { runner, store } = createFakeTransactionRunner();

    const result = await analyzeConversationAndCreateDecisions(baseInput(), {
      aiProvider: mock.provider,
      transactionRunner: runner,
    });

    expect(result.conversationSnapshotId).toBeTruthy();
    expect(result.decisions).toHaveLength(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].eventType).toBe("PROPOSED");
    expect(result.events[0].decisionRecordId).toBe(result.decisions[0].id);
    expect(result.decisions[0].conversationSnapshotId).toBe(result.conversationSnapshotId);
    expect(result.decisions[0].businessId).toBe("biz-1");

    expect(store.conversationSnapshots.size).toBe(1);
    expect(store.decisions.size).toBe(1);
    expect(store.decisionEvents.size).toBe(1);
  });

  it("4. persists multiple decisions correctly, each with its own PROPOSED event", async () => {
    const mock = mockAI(3);
    const { runner, store } = createFakeTransactionRunner();

    const result = await analyzeConversationAndCreateDecisions(baseInput(), {
      aiProvider: mock.provider,
      transactionRunner: runner,
    });

    expect(result.decisions).toHaveLength(3);
    expect(result.events).toHaveLength(3);
    expect(new Set(result.decisions.map((d) => d.id)).size).toBe(3);
    expect(result.events.every((e) => e.eventType === "PROPOSED")).toBe(true);
    expect(result.decisions.every((d) => d.conversationSnapshotId === result.conversationSnapshotId)).toBe(true);

    expect(store.decisions.size).toBe(3);
    expect(store.decisionEvents.size).toBe(3);
  });

  it("aggregates CIE + decision warnings into one flat list", async () => {
    const mock = createMockAIProvider({
      response: () => JSON.stringify({ ...minimalProviderResult(), warnings: [{ code: "TEST", message: "cie warning", severity: "info" }] }),
      decisionReasoningResponse: () => JSON.stringify({ decisions: [decisionProposal("Decision 1")] }),
    });
    const { runner } = createFakeTransactionRunner();

    const result = await analyzeConversationAndCreateDecisions(baseInput(), {
      aiProvider: mock.provider,
      transactionRunner: runner,
    });

    expect(result.warnings.some((w) => w.code === "TEST")).toBe(true);
  });
});

describe("analyzeConversationAndCreateDecisions — rollback / atomicity", () => {
  it("2. rolls back the snapshot and all previous decisions if saving a later decision fails", async () => {
    let saveCalls = 0;
    const { runner, store } = createFakeTransactionRunner({
      decisions: (base) => ({
        ...base,
        save: async (input) => {
          saveCalls += 1;
          if (saveCalls === 2) {
            throw new Error("simulated failure saving the second decision");
          }
          return base.save(input);
        },
      }),
    });
    const mock = mockAI(2);

    await expect(
      analyzeConversationAndCreateDecisions(baseInput(), { aiProvider: mock.provider, transactionRunner: runner }),
    ).rejects.toBeInstanceOf(OrchestrationTransactionError);

    expect(store.conversationSnapshots.size).toBe(0);
    expect(store.decisions.size).toBe(0);
    expect(store.decisionEvents.size).toBe(0);
  });

  it("3. rolls back everything if appending the initial DecisionEvent fails", async () => {
    const { runner, store } = createFakeTransactionRunner({
      decisionEvents: (base) => ({
        ...base,
        append: async () => {
          throw new Error("simulated failure appending the event");
        },
      }),
    });
    const mock = mockAI(1);

    await expect(
      analyzeConversationAndCreateDecisions(baseInput(), { aiProvider: mock.provider, transactionRunner: runner }),
    ).rejects.toBeInstanceOf(OrchestrationTransactionError);

    expect(store.conversationSnapshots.size).toBe(0);
    expect(store.decisions.size).toBe(0);
    expect(store.decisionEvents.size).toBe(0);
  });
});

describe("analyzeConversationAndCreateDecisions — engine-call failures never open a transaction", () => {
  it("wraps a Conversation Intelligence failure in ConversationAnalysisFailedError", async () => {
    const mock = createMockAIProvider({ throwError: new Error("network down") });
    const { runner: baseRunner, store } = createFakeTransactionRunner();
    let transactionOpened = false;
    const runner: TransactionRunner = {
      runInTransaction: (work) => {
        transactionOpened = true;
        return baseRunner.runInTransaction(work);
      },
    };

    await expect(
      analyzeConversationAndCreateDecisions(baseInput(), { aiProvider: mock.provider, transactionRunner: runner }),
    ).rejects.toBeInstanceOf(ConversationAnalysisFailedError);

    expect(transactionOpened).toBe(false);
    expect(store.conversationSnapshots.size).toBe(0);
  });

  it("wraps a Decision Engine failure in DecisionGenerationFailedError", async () => {
    const mock = createMockAIProvider({
      response: () => JSON.stringify(minimalProviderResult()),
      decisionReasoningThrowError: new Error("network down"),
    });
    const { runner: baseRunner, store } = createFakeTransactionRunner();
    let transactionOpened = false;
    const runner: TransactionRunner = {
      runInTransaction: (work) => {
        transactionOpened = true;
        return baseRunner.runInTransaction(work);
      },
    };

    await expect(
      analyzeConversationAndCreateDecisions(baseInput(), { aiProvider: mock.provider, transactionRunner: runner }),
    ).rejects.toBeInstanceOf(DecisionGenerationFailedError);

    expect(transactionOpened).toBe(false);
    expect(store.conversationSnapshots.size).toBe(0);
  });
});
