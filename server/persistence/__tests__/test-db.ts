// Shared setup for gated repository/DB integration tests. Mirrors
// server/intelligence/__tests__/anthropic-ai-provider.integration.test.ts's
// opt-in convention: skipped by default, never gates `npm test`, and never
// touches the app's configured DATABASE_URL (the pilot database) — these
// tests build their own PrismaClient against TEST_DATABASE_URL only.

import { config } from "dotenv";

config({ path: ".env.test.local" });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../db/generated/client";
import { PrismaDecisionRepository } from "../prisma/prisma-decision-repository";
import { buildKoriDecision } from "../../intelligence/testing/fixtures";

export const shouldRunDbTests = process.env.RUN_DB_TESTS === "true" && Boolean(process.env.TEST_DATABASE_URL);

let testPrisma: PrismaClient | undefined;

/** Lazy — only ever constructed inside a describe.skipIf(!shouldRunDbTests) block. */
export function getTestPrisma(): PrismaClient {
  if (!testPrisma) {
    const connectionString = process.env.TEST_DATABASE_URL;
    if (!connectionString) {
      throw new Error("TEST_DATABASE_URL is not configured. See .env.test.local / .env.example.");
    }
    testPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  }
  return testPrisma;
}

export interface TestFixture {
  businessId: string;
  userId: string;
  leadId: string;
  conversationId: string;
}

/** Creates a fully isolated Business/User/Lead/Conversation chain for one test. */
export async function createTestFixture(db: PrismaClient, label: string): Promise<TestFixture> {
  const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const business = await db.business.create({ data: { name: `test-business-${suffix}` } });
  const user = await db.user.create({
    data: {
      email: `test-${suffix}@example.com`,
      name: "Test Advisor",
      role: "SALESPERSON",
      businessId: business.id,
    },
  });
  const lead = await db.lead.create({
    data: { businessId: business.id, name: "Test Lead", phone: "+10000000000", assignedToUserId: user.id },
  });
  const conversation = await db.conversation.create({
    data: {
      businessId: business.id,
      leadId: lead.id,
      source: "MANUAL_PASTE",
      lastEntryAt: new Date(),
      lastEntryDirection: "INBOUND",
      createdByUserId: user.id,
    },
  });

  return { businessId: business.id, userId: user.id, leadId: lead.id, conversationId: conversation.id };
}

/**
 * Convenience for DecisionEvent/AdvisorAction/Outcome repository tests,
 * which all need a real DecisionRecord to hang off — not a mapping concern
 * of theirs, so it's factored out here rather than duplicated per test file.
 */
export async function createDecisionRecordFixture(db: PrismaClient, fixture: TestFixture): Promise<string> {
  const decisionRepo = new PrismaDecisionRepository(db);
  const decision = buildKoriDecision({
    metadata: { ...buildKoriDecision().metadata, conversationId: fixture.conversationId },
  });
  const saved = await decisionRepo.save({ businessId: fixture.businessId, decision });
  return saved.id;
}

/** Deletes everything a fixture (and any test writes hung off it) created, leaf-to-root. */
export async function cleanupTestFixture(db: PrismaClient, fixture: TestFixture): Promise<void> {
  // Outcome's own conversationId (Kori Sales Memory v1) — not the
  // decisionRecord join — so this sweeps both decision-attached outcomes
  // and the decision-less ones the lightweight recording path creates.
  await db.outcome.deleteMany({ where: { conversationId: fixture.conversationId } });
  await db.advisorAction.deleteMany({ where: { decisionRecord: { conversationId: fixture.conversationId } } });
  await db.decisionEvent.deleteMany({ where: { decisionRecord: { conversationId: fixture.conversationId } } });
  await db.decisionRecord.deleteMany({ where: { conversationId: fixture.conversationId } });
  await db.conversationSnapshot.deleteMany({ where: { conversationId: fixture.conversationId } });
  // Observer Mode v1 — observations reference domainEvents, so they're
  // deleted first even though both hang directly off the conversation.
  await db.observation.deleteMany({ where: { conversationId: fixture.conversationId } });
  await db.domainEvent.deleteMany({ where: { conversationId: fixture.conversationId } });
  await db.conversationEntry.deleteMany({ where: { conversationId: fixture.conversationId } });
  await db.conversation.delete({ where: { id: fixture.conversationId } });
  // LeadCommercialProfile has no cascade delete off Lead (matches
  // Conversation.lead/FollowUp.lead's existing no-cascade convention) —
  // deleteMany is a safe no-op for fixtures that never created one.
  await db.leadCommercialProfile.deleteMany({ where: { leadId: fixture.leadId } });
  await db.lead.delete({ where: { id: fixture.leadId } });
  await db.user.delete({ where: { id: fixture.userId } });
  await db.business.delete({ where: { id: fixture.businessId } });
}
