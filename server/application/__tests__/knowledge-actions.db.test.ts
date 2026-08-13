// Gated integration test proving analyzeConversationImportHandler end to
// end — real parser, real persistence, real reinforcement pipeline, only
// the AI provider mocked — against sales_os_test only. Same RUN_DB_TESTS
// convention as analyze-conversation-action.db.test.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAIProvider } from "@/server/intelligence/testing/mock-ai-provider";
import {
  cleanupKnowledgeTestFixture,
  createKnowledgeTestFixture,
  getTestPrisma,
  shouldRunDbTests,
  type KnowledgeTestFixture,
} from "@/server/knowledge/__tests__/test-db";
import { createFakeAuthContextResolver } from "../testing/fake-auth";
import { analyzeConversationImportHandler } from "../knowledge-actions";

const SAMPLE_EXPORT = [
  "27/07/26, 14:00 - Los mensajes y las llamadas están cifrados de extremo a extremo.",
  "27/07/26, 14:05 - Juan Pérez: Hola, quiero saber si el TRAVO sirve para mi Hilux 2018",
  "27/07/26, 14:06 - Test Owner: Sí, el TRAVO sirve para Hilux Revo desde 2016.",
  "27/07/26, 14:07 - Juan Pérez: Perfecto, gracias",
].join("\n");

function knowledgeExtractionResult(): string {
  return JSON.stringify({
    candidates: [
      {
        class: "FACTUAL",
        proposedCategory: "COMPATIBILITY",
        subject: "Hilux TRAVO",
        statement: "Compatible con Hilux Revo desde 2016.",
        evidenceRefIndex: 1,
        evidenceQuote: "el TRAVO sirve para Hilux Revo desde 2016",
        confidence: 0.9,
      },
    ],
  });
}

describe.skipIf(!shouldRunDbTests)("analyzeConversationImportHandler — real pipeline against sales_os_test (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: KnowledgeTestFixture;

  beforeEach(async () => {
    fixture = await createKnowledgeTestFixture(db!, "knowledge-actions-db");
  });

  afterEach(async () => {
    await cleanupKnowledgeTestFixture(db!, fixture);
  });

  it("parses, persists, extracts, and reinforces end to end (deterministic + LLM both contribute), producing the UI summary", async () => {
    const resolver = createFakeAuthContextResolver({ id: fixture.ownerUserId, businessId: fixture.businessId, role: "OWNER" });
    const mock = createMockAIProvider({ knowledgeExtractionResponse: knowledgeExtractionResult() });

    const result = await analyzeConversationImportHandler(
      { rawText: SAMPLE_EXPORT, externalSource: "PASTED_TEXT", sourceConversationId: "test-paste-1" },
      { resolver, aiProvider: mock.provider, db: db! },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.status).toBe("COMPLETED");
    if (result.data.status !== "COMPLETED") throw new Error("unreachable");

    // "Test Owner" (the BUSINESS-resolved sender) says a general
    // compatibility statement, which the new deterministic rule fires on in
    // addition to the mocked LLM's own (differently-worded) candidate —
    // both extraction layers ran and both contributed.
    expect(result.data.summary).toEqual({ messagesAnalyzed: 3, candidatesFound: 2, reinforced: 0, conflicts: 0 });

    const candidates = await db!.knowledgeCandidate.findMany({ where: { businessId: fixture.businessId }, orderBy: { extractorName: "asc" } });
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.extractorName).sort()).toEqual(["deterministic", "kori"]);
    expect(candidates.every((c) => c.subject === "Hilux TRAVO")).toBe(true);

    const conversation = await db!.importedConversation.findFirstOrThrow({ where: { sourceId: result.data.sourceId } });
    expect(conversation.semanticAnalysisStatus).toBe("COMPLETED"); // a real LLM pass ran

    const source = await db!.knowledgeSource.findUniqueOrThrow({ where: { id: result.data.sourceId } });
    expect(source.status).toBe("COMPLETED");
    expect(source.lastRunSummary).toEqual(result.data.summary);
  });

  it("rejects a SALESPERSON — knowledge ingestion is OWNER-only", async () => {
    const resolver = createFakeAuthContextResolver({ id: fixture.userId, businessId: fixture.businessId, role: "SALESPERSON" });
    const mock = createMockAIProvider();

    const result = await analyzeConversationImportHandler(
      { rawText: SAMPLE_EXPORT, externalSource: "PASTED_TEXT", sourceConversationId: "test-paste-2" },
      { resolver, aiProvider: mock.provider, db: db! },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("FORBIDDEN");
  });

  it("requires participant resolution for an unmatched 1:1 chat, and completes once answered", async () => {
    const resolver = createFakeAuthContextResolver({ id: fixture.ownerUserId, businessId: fixture.businessId, role: "OWNER" });
    const mock = createMockAIProvider({ knowledgeExtractionResponse: knowledgeExtractionResult() });
    const rawText = ["27/07/26, 14:05 - Ana Torres: Hola", "27/07/26, 14:06 - Carlos Ruiz: Hola, tengo una consulta"].join("\n");

    const first = await analyzeConversationImportHandler(
      { rawText, externalSource: "PASTED_TEXT", sourceConversationId: "test-paste-3" },
      { resolver, aiProvider: mock.provider, db: db! },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");
    expect(first.data.status).toBe("NEEDS_PARTICIPANT_RESOLUTION");
    if (first.data.status !== "NEEDS_PARTICIPANT_RESOLUTION") throw new Error("unreachable");
    expect(first.data.candidateLabels).toEqual(["Ana Torres", "Carlos Ruiz"]);

    // No KnowledgeSource was created for the unresolved attempt.
    const sourcesAfterFirst = await db!.knowledgeSource.findMany({ where: { businessId: fixture.businessId } });
    expect(sourcesAfterFirst).toHaveLength(0);

    const second = await analyzeConversationImportHandler(
      {
        rawText,
        externalSource: "PASTED_TEXT",
        sourceConversationId: "test-paste-3",
        manualBusinessSenderLabel: "Ana Torres",
      },
      { resolver, aiProvider: mock.provider, db: db! },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.data.status).toBe("COMPLETED");
  });

  it("rejects a re-import of the same file hash", async () => {
    const resolver = createFakeAuthContextResolver({ id: fixture.ownerUserId, businessId: fixture.businessId, role: "OWNER" });
    const mock = createMockAIProvider({ knowledgeExtractionResponse: knowledgeExtractionResult() });

    await analyzeConversationImportHandler(
      { rawText: SAMPLE_EXPORT, externalSource: "WHATSAPP_TXT_EXPORT", sourceConversationId: "chat.txt", rawFileHash: "dup-hash-1" },
      { resolver, aiProvider: mock.provider, db: db! },
    );

    const second = await analyzeConversationImportHandler(
      { rawText: SAMPLE_EXPORT, externalSource: "WHATSAPP_TXT_EXPORT", sourceConversationId: "chat.txt", rawFileHash: "dup-hash-1" },
      { resolver, aiProvider: mock.provider, db: db! },
    );

    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.error.code).toBe("INVALID_INPUT");
  });

  // --- Zero-cost mode (Sprint 8 review) -------------------------------------

  it("zero-AI mode: import completes, deterministic candidates are created, and the source is never FAILED for lack of AI", async () => {
    const resolver = createFakeAuthContextResolver({ id: fixture.ownerUserId, businessId: fixture.businessId, role: "OWNER" });

    // No AI provider at all — undefined, not a mock. Same shape as
    // tryGetAIProvider()'s real return value in this environment (no
    // AI_PROVIDER/AI_MODEL/ANTHROPIC_API_KEY configured).
    const result = await analyzeConversationImportHandler(
      { rawText: SAMPLE_EXPORT, externalSource: "PASTED_TEXT", sourceConversationId: "test-paste-zero-ai" },
      { resolver, aiProvider: undefined, db: db! },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.status).toBe("COMPLETED");
    if (result.data.status !== "COMPLETED") throw new Error("unreachable");

    expect(result.data.summary).toEqual({ messagesAnalyzed: 3, candidatesFound: 1, reinforced: 0, conflicts: 0 });

    const candidates = await db!.knowledgeCandidate.findMany({ where: { businessId: fixture.businessId } });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ subject: "Hilux TRAVO", extractorName: "deterministic" });

    const conversation = await db!.importedConversation.findFirstOrThrow({ where: { sourceId: result.data.sourceId } });
    expect(conversation.semanticAnalysisStatus).toBe("PENDING"); // never COMPLETED — no LLM pass ran

    const source = await db!.knowledgeSource.findUniqueOrThrow({ where: { id: result.data.sourceId } });
    expect(source.status).toBe("COMPLETED"); // never FAILED for lack of AI
    expect(source.errorMessage).toBeNull();
  });
});
