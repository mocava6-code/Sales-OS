// Shared fixtures for Knowledge Ingestion DB tests — same RUN_DB_TESTS gate,
// same isolated sales_os_test instance as server/whatsapp/__tests__/test-db.ts.

import type { PrismaClient } from "../../db/generated/client";
import { cleanupTestFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "../../persistence/__tests__/test-db";

export { getTestPrisma, shouldRunDbTests };

export interface KnowledgeTestFixture extends TestFixture {
  ownerUserId: string;
}

/** Extends the base fixture with a second, OWNER-role user — Knowledge mutations are OWNER-only. */
export async function createKnowledgeTestFixture(db: PrismaClient, label: string): Promise<KnowledgeTestFixture> {
  const base = await createTestFixture(db, label);
  const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const owner = await db.user.create({
    data: { email: `owner-${suffix}@example.com`, name: "Test Owner", role: "OWNER", businessId: base.businessId },
  });
  return { ...base, ownerUserId: owner.id };
}

export async function cleanupKnowledgeTestFixture(db: PrismaClient, fixture: KnowledgeTestFixture): Promise<void> {
  const sources = await db.knowledgeSource.findMany({ where: { businessId: fixture.businessId }, select: { id: true } });
  const sourceIds = sources.map((s) => s.id);

  if (sourceIds.length > 0) {
    await db.knowledgeCandidateRelationship.deleteMany({ where: { businessId: fixture.businessId } });
    await db.knowledgeCandidateEvidence.deleteMany({ where: { sourceId: { in: sourceIds } } });
    await db.knowledgeCandidate.deleteMany({ where: { businessId: fixture.businessId } });
    await db.operationalInsight.deleteMany({ where: { businessId: fixture.businessId } });
    await db.knowledgeItem.deleteMany({ where: { businessId: fixture.businessId } });
    await db.importedMessage.deleteMany({ where: { importedConversation: { sourceId: { in: sourceIds } } } });
    await db.importedConversation.deleteMany({ where: { sourceId: { in: sourceIds } } });
    await db.websitePage.deleteMany({ where: { sourceId: { in: sourceIds } } });
    await db.knowledgeSource.deleteMany({ where: { id: { in: sourceIds } } });
  }

  await db.user.delete({ where: { id: fixture.ownerUserId } });
  await cleanupTestFixture(db, fixture);
}
