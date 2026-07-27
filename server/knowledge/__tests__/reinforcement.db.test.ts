// Gated: proves reinforcement.ts against a real sales_os_test instance —
// same RUN_DB_TESTS convention as server/whatsapp/__tests__/gateway.db.test.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAIProvider } from "@/server/intelligence/testing/mock-ai-provider";
import { reinforceCandidate } from "../reinforcement";
import type { ExtractedKnowledgeCandidate } from "../extracted-candidate";
import { cleanupKnowledgeTestFixture, createKnowledgeTestFixture, getTestPrisma, shouldRunDbTests, type KnowledgeTestFixture } from "./test-db";

function candidate(overrides: Partial<ExtractedKnowledgeCandidate> = {}): ExtractedKnowledgeCandidate {
  return {
    class: "FACTUAL",
    proposedCategory: "COMPATIBILITY",
    subject: "Hilux TRAVO",
    statement: "El TRAVO sirve para Hilux Revo desde 2016.",
    confidence: 0.9,
    evidenceText: "el TRAVO sirve para Hilux Revo desde 2016",
    evidenceRefType: "IMPORTED_MESSAGE",
    evidenceRefId: "msg-1",
    ...overrides,
  };
}

describe.skipIf(!shouldRunDbTests)("reinforcement — real pipeline against sales_os_test (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: KnowledgeTestFixture;
  let sourceId: string;

  beforeEach(async () => {
    fixture = await createKnowledgeTestFixture(db!, "reinforcement-db");
    const source = await db!.knowledgeSource.create({
      data: { businessId: fixture.businessId, sourceType: "WHATSAPP_IMPORT", label: "test", status: "PROCESSING", createdByUserId: fixture.ownerUserId },
    });
    sourceId = source.id;
  });

  afterEach(async () => {
    await cleanupKnowledgeTestFixture(db!, fixture);
  });

  it("creates a new candidate on first occurrence with no shortlist match", async () => {
    const mock = createMockAIProvider();

    const result = await reinforceCandidate(
      { businessId: fixture.businessId, originSourceId: sourceId, extractorName: "kori", extractorVersion: "v1", extracted: candidate() },
      mock.provider,
      db!,
    );

    expect(result.outcome).toBe("CREATED");
    expect(result.status).toBe("NEW");

    const stored = await db!.knowledgeCandidate.findUniqueOrThrow({ where: { id: result.candidateId } });
    expect(stored.occurrenceCount).toBe(1);
    expect(stored.originSourceId).toBe(sourceId);

    const evidence = await db!.knowledgeCandidateEvidence.findMany({ where: { candidateId: result.candidateId } });
    expect(evidence).toHaveLength(1);
  });

  it("merges an obviously-equivalent restatement into the existing candidate rather than creating a copy", async () => {
    const mock = createMockAIProvider();

    const first = await reinforceCandidate(
      { businessId: fixture.businessId, originSourceId: sourceId, extractorName: "kori", extractorVersion: "v1", extracted: candidate() },
      mock.provider,
      db!,
    );

    const second = await reinforceCandidate(
      {
        businessId: fixture.businessId,
        originSourceId: sourceId,
        extractorName: "kori",
        extractorVersion: "v1",
        extracted: candidate({ statement: "El TRAVO sirve para Hilux Revo desde 2016.", evidenceRefId: "msg-2" }),
      },
      mock.provider,
      db!,
    );

    expect(second.outcome).toBe("MERGED");
    expect(second.candidateId).toBe(first.candidateId);
    expect(second.status).toBe("REINFORCED");

    const stored = await db!.knowledgeCandidate.findUniqueOrThrow({ where: { id: first.candidateId } });
    expect(stored.occurrenceCount).toBe(2);

    const evidence = await db!.knowledgeCandidateEvidence.findMany({ where: { candidateId: first.candidateId } });
    expect(evidence).toHaveLength(2);

    // No second row was created.
    const allCandidates = await db!.knowledgeCandidate.findMany({ where: { businessId: fixture.businessId } });
    expect(allCandidates).toHaveLength(1);
  });

  it("uses the LLM relationship classifier for an ambiguous (non-obvious) statement pair", async () => {
    const mock = createMockAIProvider({
      knowledgeExtractionResponse: JSON.stringify({ classification: "CONTRADICTORY", confidence: 0.8 }),
    });

    const first = await reinforceCandidate(
      { businessId: fixture.businessId, originSourceId: sourceId, extractorName: "kori", extractorVersion: "v1", extracted: candidate() },
      mock.provider,
      db!,
    );

    // Same subject, meaningfully different statement — falls in the
    // ambiguous middle, must invoke the LLM classifier (mocked here).
    const second = await reinforceCandidate(
      {
        businessId: fixture.businessId,
        originSourceId: sourceId,
        extractorName: "kori",
        extractorVersion: "v1",
        extracted: candidate({ statement: "El TRAVO NO es compatible con la Hilux 2020 en adelante.", evidenceRefId: "msg-3" }),
      },
      mock.provider,
      db!,
    );

    expect(mock.getKnowledgeExtractionCallCount()).toBeGreaterThan(0);
    expect(second.status).toBe("CONFLICT");

    const relationships = await db!.knowledgeCandidateRelationship.findMany({ where: { candidateId: second.candidateId } });
    expect(relationships.some((r) => r.classification === "CONTRADICTORY" && r.targetCandidateId === first.candidateId)).toBe(true);
  });

  it("is sticky: a later EQUIVALENT occurrence never reverts an existing CONFLICT back to REINFORCED", async () => {
    const mock = createMockAIProvider({
      knowledgeExtractionResponse: JSON.stringify({ classification: "CONTRADICTORY", confidence: 0.8 }),
    });

    const first = await reinforceCandidate(
      { businessId: fixture.businessId, originSourceId: sourceId, extractorName: "kori", extractorVersion: "v1", extracted: candidate() },
      mock.provider,
      db!,
    );
    const second = await reinforceCandidate(
      {
        businessId: fixture.businessId,
        originSourceId: sourceId,
        extractorName: "kori",
        extractorVersion: "v1",
        extracted: candidate({ statement: "El TRAVO NO es compatible con la Hilux 2020 en adelante.", evidenceRefId: "msg-3" }),
      },
      mock.provider,
      db!,
    );
    expect(second.status).toBe("CONFLICT");

    const beforeCount = (await db!.knowledgeCandidate.findUniqueOrThrow({ where: { id: second.candidateId } })).occurrenceCount;

    // Now a restatement that's an obvious (deterministic) EQUIVALENT match
    // to the CONFLICT candidate's own statement.
    const third = await reinforceCandidate(
      {
        businessId: fixture.businessId,
        originSourceId: sourceId,
        extractorName: "kori",
        extractorVersion: "v1",
        extracted: candidate({
          subject: "Hilux TRAVO",
          statement: "El TRAVO NO es compatible con la Hilux 2020 en adelante.",
          evidenceRefId: "msg-4",
        }),
      },
      mock.provider,
      db!,
    );

    expect(third.candidateId).toBe(second.candidateId);
    expect(third.status).toBe("CONFLICT"); // still CONFLICT, not reverted to REINFORCED

    const after = await db!.knowledgeCandidate.findUniqueOrThrow({ where: { id: second.candidateId } });
    expect(after.status).toBe("CONFLICT");
    expect(after.occurrenceCount).toBe(beforeCount + 1); // evidence still accumulates
    void first;
  });

  it("forces CONFLICT on first occurrence when it contradicts an already-approved KnowledgeItem", async () => {
    const mock = createMockAIProvider({
      knowledgeExtractionResponse: JSON.stringify({ classification: "CONTRADICTORY", confidence: 0.9 }),
    });

    await db!.knowledgeItem.create({
      data: {
        businessId: fixture.businessId,
        title: "Hilux TRAVO",
        content: "El TRAVO es compatible con Hilux Revo únicamente desde 2018.",
        category: "COMPATIBILITY",
        createdByUserId: fixture.ownerUserId,
        approvedByUserId: fixture.ownerUserId,
        approvedAt: new Date(),
      },
    });

    const result = await reinforceCandidate(
      {
        businessId: fixture.businessId,
        originSourceId: sourceId,
        extractorName: "kori",
        extractorVersion: "v1",
        extracted: candidate({ statement: "El TRAVO sirve para Hilux Revo desde 2016." }),
      },
      mock.provider,
      db!,
    );

    expect(result.outcome).toBe("CREATED");
    expect(result.status).toBe("CONFLICT");

    const relationships = await db!.knowledgeCandidateRelationship.findMany({ where: { candidateId: result.candidateId } });
    expect(relationships.some((r) => r.classification === "CONTRADICTORY" && r.targetKnowledgeItemId !== null)).toBe(true);
  });

  it("creates a distinct candidate for an unrelated subject rather than forcing a match", async () => {
    const mock = createMockAIProvider();

    const first = await reinforceCandidate(
      { businessId: fixture.businessId, originSourceId: sourceId, extractorName: "kori", extractorVersion: "v1", extracted: candidate() },
      mock.provider,
      db!,
    );
    const second = await reinforceCandidate(
      {
        businessId: fixture.businessId,
        originSourceId: sourceId,
        extractorName: "kori",
        extractorVersion: "v1",
        extracted: candidate({
          proposedCategory: "LOGISTICS",
          subject: "Envíos a provincia",
          statement: "Para provincia enviamos por Shalom.",
          evidenceRefId: "msg-5",
        }),
      },
      mock.provider,
      db!,
    );

    expect(second.outcome).toBe("CREATED");
    expect(second.candidateId).not.toBe(first.candidateId);
    expect(second.status).toBe("NEW");
  });
});
