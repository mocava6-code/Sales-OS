// Gated: proves promoteCandidateHandler/rejectCandidateHandler's OWNER
// gating and tenant scoping — promotion.ts's own logic is already proven in
// server/knowledge/__tests__/promotion.db.test.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupKnowledgeTestFixture, createKnowledgeTestFixture, getTestPrisma, shouldRunDbTests, type KnowledgeTestFixture } from "@/server/knowledge/__tests__/test-db";
import { createFakeAuthContextResolver } from "../testing/fake-auth";
import { promoteCandidateHandler, rejectCandidateHandler } from "../knowledge-actions";

describe.skipIf(!shouldRunDbTests)("knowledge review actions — real pipeline against sales_os_test (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: KnowledgeTestFixture;
  let candidateId: string;

  beforeEach(async () => {
    fixture = await createKnowledgeTestFixture(db!, "knowledge-review-actions-db");
    const source = await db!.knowledgeSource.create({
      data: { businessId: fixture.businessId, sourceType: "WHATSAPP_IMPORT", label: "test", status: "COMPLETED", createdByUserId: fixture.ownerUserId },
    });
    const candidate = await db!.knowledgeCandidate.create({
      data: {
        businessId: fixture.businessId,
        class: "FACTUAL",
        proposedFactualCategory: "COMPATIBILITY",
        subject: "Hilux TRAVO",
        statement: "Compatible con Hilux Revo desde 2016.",
        originSourceId: source.id,
        confidence: 0.9,
        status: "NEW",
        extractorName: "kori",
        extractorVersion: "v1",
      },
    });
    candidateId = candidate.id;
  });

  afterEach(async () => {
    await cleanupKnowledgeTestFixture(db!, fixture);
  });

  it("rejects a SALESPERSON from promoting a candidate", async () => {
    const resolver = createFakeAuthContextResolver({ id: fixture.userId, businessId: fixture.businessId, role: "SALESPERSON" });
    const result = await promoteCandidateHandler({ candidateId }, { resolver, db: db! });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("FORBIDDEN");
  });

  it("OWNER can promote a candidate into a KnowledgeItem", async () => {
    const resolver = createFakeAuthContextResolver({ id: fixture.ownerUserId, businessId: fixture.businessId, role: "OWNER" });
    const result = await promoteCandidateHandler({ candidateId }, { resolver, db: db! });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.knowledgeItemId).toBeTruthy();
  });

  it("OWNER can reject a candidate", async () => {
    const resolver = createFakeAuthContextResolver({ id: fixture.ownerUserId, businessId: fixture.businessId, role: "OWNER" });
    const result = await rejectCandidateHandler({ candidateId, rejectionReason: "Too speculative" }, { resolver, db: db! });
    expect(result.ok).toBe(true);
    const updated = await db!.knowledgeCandidate.findUniqueOrThrow({ where: { id: candidateId } });
    expect(updated.status).toBe("REJECTED");
  });

  it("rejects a cross-tenant candidateId as NOT_FOUND", async () => {
    const otherFixture = await createKnowledgeTestFixture(db!, "knowledge-review-actions-db-other");
    try {
      const resolver = createFakeAuthContextResolver({ id: otherFixture.ownerUserId, businessId: otherFixture.businessId, role: "OWNER" });
      const result = await promoteCandidateHandler({ candidateId }, { resolver, db: db! });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.code).toBe("NOT_FOUND");
    } finally {
      await cleanupKnowledgeTestFixture(db!, otherFixture);
    }
  });
});
