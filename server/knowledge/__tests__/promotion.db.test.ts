// Gated: proves promotion.ts against a real sales_os_test instance — the
// only place a KnowledgeCandidate becomes organizational truth.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@/server/db/generated/client";
import { InvalidCandidateStatusTransitionError, KnowledgeCandidateNotFoundError } from "../errors";
import { promoteCandidate, rejectCandidate } from "../promotion";
import { cleanupKnowledgeTestFixture, createKnowledgeTestFixture, getTestPrisma, shouldRunDbTests, type KnowledgeTestFixture } from "./test-db";

describe.skipIf(!shouldRunDbTests)("promotion — real pipeline against sales_os_test (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: KnowledgeTestFixture;
  let sourceId: string;

  beforeEach(async () => {
    fixture = await createKnowledgeTestFixture(db!, "promotion-db");
    const source = await db!.knowledgeSource.create({
      data: { businessId: fixture.businessId, sourceType: "WHATSAPP_IMPORT", label: "test", status: "COMPLETED", createdByUserId: fixture.ownerUserId },
    });
    sourceId = source.id;
  });

  afterEach(async () => {
    await cleanupKnowledgeTestFixture(db!, fixture);
  });

  async function createCandidate(overrides: Partial<Prisma.KnowledgeCandidateUncheckedCreateInput> = {}) {
    return db!.knowledgeCandidate.create({
      data: {
        businessId: fixture.businessId,
        class: "FACTUAL",
        proposedFactualCategory: "COMPATIBILITY",
        subject: "Hilux TRAVO",
        statement: "Compatible con Hilux Revo desde 2016.",
        originSourceId: sourceId,
        confidence: 0.9,
        status: "NEW",
        extractorName: "kori",
        extractorVersion: "v1",
        ...overrides,
      },
    });
  }

  it("promotes a FACTUAL candidate into a KnowledgeItem", async () => {
    const candidate = await createCandidate();

    const result = await promoteCandidate(candidate.id, fixture.businessId, fixture.ownerUserId, db!);

    expect(result.knowledgeItemId).toBeTruthy();
    const item = await db!.knowledgeItem.findUniqueOrThrow({ where: { id: result.knowledgeItemId! } });
    expect(item).toMatchObject({
      title: "Hilux TRAVO",
      content: "Compatible con Hilux Revo desde 2016.",
      category: "COMPATIBILITY",
      status: "ACTIVE",
      approvedByUserId: fixture.ownerUserId,
      originCandidateId: candidate.id,
    });
    expect(item.expiresAt).toBeNull();

    const updatedCandidate = await db!.knowledgeCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    expect(updatedCandidate.status).toBe("APPROVED");
    expect(updatedCandidate.promotedKnowledgeItemId).toBe(item.id);
  });

  it("sets a freshness expiresAt for a PRICING candidate", async () => {
    const candidate = await createCandidate({ proposedFactualCategory: "PRICING", subject: "Precio TRAVO", statement: "El TRAVO cuesta S/450." });

    const result = await promoteCandidate(candidate.id, fixture.businessId, fixture.ownerUserId, db!);

    const item = await db!.knowledgeItem.findUniqueOrThrow({ where: { id: result.knowledgeItemId! } });
    expect(item.expiresAt).not.toBeNull();
    expect(item.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("promotes a BEHAVIORAL candidate into an OperationalInsight, never a KnowledgeItem", async () => {
    const candidate = await createCandidate({
      class: "BEHAVIORAL",
      proposedFactualCategory: null,
      proposedBehaviorCategory: "PROCESS_PATTERN",
      subject: "Confirmar año",
      statement: "Confirmar modelo/año antes de dar recomendación de compatibilidad.",
    });

    const result = await promoteCandidate(candidate.id, fixture.businessId, fixture.ownerUserId, db!);

    expect(result.operationalInsightId).toBeTruthy();
    expect(result.knowledgeItemId).toBeUndefined();
    const insight = await db!.operationalInsight.findUniqueOrThrow({ where: { id: result.operationalInsightId! } });
    expect(insight).toMatchObject({ category: "PROCESS_PATTERN", status: "ACTIVE", approvedByUserId: fixture.ownerUserId });

    const itemCount = await db!.knowledgeItem.count({ where: { businessId: fixture.businessId } });
    expect(itemCount).toBe(0);
  });

  it("rejects a candidate with a reason", async () => {
    const candidate = await createCandidate();

    await rejectCandidate(candidate.id, fixture.businessId, fixture.ownerUserId, "Not actually a general fact.", db!);

    const updated = await db!.knowledgeCandidate.findUniqueOrThrow({ where: { id: candidate.id } });
    expect(updated.status).toBe("REJECTED");
    expect(updated.rejectionReason).toBe("Not actually a general fact.");
  });

  it("promoting a candidate auto-rejects a CONTRADICTORY pending candidate", async () => {
    const candidateA = await createCandidate({ statement: "El TRAVO sirve para Hilux Revo desde 2016." });
    const candidateB = await createCandidate({ statement: "El TRAVO NO es compatible con la Hilux 2020 en adelante.", status: "CONFLICT" });
    await db!.knowledgeCandidateRelationship.create({
      data: { businessId: fixture.businessId, candidateId: candidateA.id, targetCandidateId: candidateB.id, classification: "CONTRADICTORY", classifierName: "test", classifierVersion: "v1" },
    });

    await promoteCandidate(candidateA.id, fixture.businessId, fixture.ownerUserId, db!);

    const updatedB = await db!.knowledgeCandidate.findUniqueOrThrow({ where: { id: candidateB.id } });
    expect(updatedB.status).toBe("REJECTED");
    expect(updatedB.rejectionReason).toContain(candidateA.id);
  });

  it("promoting a candidate supersedes a CONTRADICTORY approved KnowledgeItem", async () => {
    const oldItem = await db!.knowledgeItem.create({
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
    const candidate = await createCandidate({ status: "CONFLICT" });
    await db!.knowledgeCandidateRelationship.create({
      data: { businessId: fixture.businessId, candidateId: candidate.id, targetKnowledgeItemId: oldItem.id, classification: "CONTRADICTORY", classifierName: "test", classifierVersion: "v1" },
    });

    const result = await promoteCandidate(candidate.id, fixture.businessId, fixture.ownerUserId, db!);

    const updatedOldItem = await db!.knowledgeItem.findUniqueOrThrow({ where: { id: oldItem.id } });
    expect(updatedOldItem.status).toBe("SUPERSEDED");
    expect(updatedOldItem.supersededByItemId).toBe(result.knowledgeItemId);
  });

  it("throws for an already-APPROVED candidate", async () => {
    const candidate = await createCandidate({ status: "APPROVED" });
    await expect(promoteCandidate(candidate.id, fixture.businessId, fixture.ownerUserId, db!)).rejects.toBeInstanceOf(
      InvalidCandidateStatusTransitionError,
    );
  });

  it("throws for an already-REJECTED candidate", async () => {
    const candidate = await createCandidate({ status: "REJECTED" });
    await expect(rejectCandidate(candidate.id, fixture.businessId, fixture.ownerUserId, undefined, db!)).rejects.toBeInstanceOf(
      InvalidCandidateStatusTransitionError,
    );
  });

  it("throws KnowledgeCandidateNotFoundError for a cross-tenant candidateId", async () => {
    const otherFixture = await createKnowledgeTestFixture(db!, "promotion-db-other");
    try {
      const candidate = await createCandidate();
      await expect(promoteCandidate(candidate.id, otherFixture.businessId, otherFixture.ownerUserId, db!)).rejects.toBeInstanceOf(
        KnowledgeCandidateNotFoundError,
      );
    } finally {
      await cleanupKnowledgeTestFixture(db!, otherFixture);
    }
  });
});
