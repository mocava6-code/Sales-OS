// Gated: proves the real (non-faked) WhatsAppGateway — real lead-service,
// real conversation-service, real queue.ts, real orchestration with a mocked
// AI provider — against sales_os_test only. Every default dependency is
// bound to the test PrismaClient via createWhatsAppGateway(overrides, db);
// the only thing overridden is runAnalysis, since the default reaches for
// the app's composition-root singletons (AI_PROVIDER env + the shared
// prisma client), which this test deliberately never touches.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockAIProvider } from "../../intelligence/testing/mock-ai-provider";
import { decisionProposal, minimalProviderResult } from "../../orchestration/__tests__/provider-fixtures";
import { analyzeConversationAndCreateDecisions } from "../../orchestration/analyze-conversation-and-create-decisions";
import { PrismaTransactionRunner } from "../../persistence/prisma/prisma-transaction-runner";
import { createWhatsAppGateway } from "../gateway";
import type { NormalizedWhatsAppMessage, NormalizedWhatsAppStatus } from "../types";
import {
  cleanupWhatsAppTestFixture,
  createWhatsAppTestFixture,
  getTestPrisma,
  shouldRunDbTests,
  type WhatsAppTestFixture,
} from "./test-db";

function makeRunAnalysis(db: ReturnType<typeof getTestPrisma>) {
  const mock = createMockAIProvider({
    response: () => JSON.stringify(minimalProviderResult()),
    decisionReasoningResponse: () => JSON.stringify({ decisions: [decisionProposal("Confirm compatibility")] }),
  });
  return (input: Parameters<typeof analyzeConversationAndCreateDecisions>[0]) =>
    analyzeConversationAndCreateDecisions(input, {
      aiProvider: mock.provider,
      transactionRunner: new PrismaTransactionRunner(db),
    });
}

describe.skipIf(!shouldRunDbTests)("WhatsAppGateway — real pipeline against sales_os_test (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: WhatsAppTestFixture;

  beforeEach(async () => {
    fixture = await createWhatsAppTestFixture(db!, "gateway-db");
    // The base fixture also creates a Lead/Conversation we don't need here —
    // the gateway is responsible for creating its own from a fresh number.
  });

  afterEach(async () => {
    // Sweep any lead the gateway itself created for this business, beyond
    // the one createWhatsAppTestFixture made — must happen *before*
    // cleanupWhatsAppTestFixture deletes the business, or its FK blocks it.
    const extraLeads = await db!.lead.findMany({ where: { businessId: fixture.businessId, id: { not: fixture.leadId } } });
    for (const lead of extraLeads) {
      const conversations = await db!.conversation.findMany({ where: { leadId: lead.id }, select: { id: true } });
      const conversationIds = conversations.map((c) => c.id);
      if (conversationIds.length > 0) {
        await db!.decisionEvent.deleteMany({ where: { decisionRecord: { conversationId: { in: conversationIds } } } });
        await db!.decisionRecord.deleteMany({ where: { conversationId: { in: conversationIds } } });
        await db!.conversationSnapshot.deleteMany({ where: { conversationId: { in: conversationIds } } });
        await db!.conversationEntry.deleteMany({ where: { conversationId: { in: conversationIds } } });
      }
      await db!.conversation.deleteMany({ where: { leadId: lead.id } });
      await db!.lead.delete({ where: { id: lead.id } });
    }

    await cleanupWhatsAppTestFixture(db!, fixture);
  });

  it("5/6/7. creates a lead+conversation, persists the entry, and triggers real orchestration end to end", async () => {
    const gateway = createWhatsAppGateway({ runAnalysis: makeRunAnalysis(db!) }, db!);

    const message: NormalizedWhatsAppMessage = {
      externalId: `wamid.DB-${Date.now()}`,
      phoneNumberId: fixture.phoneNumberId,
      fromPhoneNumber: "16315559999",
      messageType: "TEXT",
      content: "Hola, tengo una Hilux 2022 y busco un kit.",
      occurredAt: new Date(),
      raw: {},
    };

    const result = await gateway.handleInboundMessage(message);

    expect(result.duplicate).toBe(false);
    expect(result.businessId).toBe(fixture.businessId);
    expect(result.analysisTriggered).toBe(true);
    expect(result.analysisError).toBeUndefined();

    const entry = await db!.conversationEntry.findUnique({ where: { externalId: message.externalId } });
    expect(entry).not.toBeNull();
    expect(entry?.content).toBe(message.content);

    const decisions = await db!.decisionRecord.findMany({ where: { conversationId: result.conversationId! } });
    expect(decisions.length).toBeGreaterThan(0);
  });

  it("4. duplicate detection: a re-delivered wamid is safely skipped at the database level", async () => {
    const gateway = createWhatsAppGateway({ runAnalysis: makeRunAnalysis(db!) }, db!);
    const message: NormalizedWhatsAppMessage = {
      externalId: `wamid.DUP-${Date.now()}`,
      phoneNumberId: fixture.phoneNumberId,
      fromPhoneNumber: "16315558888",
      messageType: "TEXT",
      content: "Hola",
      occurredAt: new Date(),
      raw: {},
    };

    const first = await gateway.handleInboundMessage(message);
    const second = await gateway.handleInboundMessage(message);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);

    const entries = await db!.conversationEntry.findMany({ where: { externalId: message.externalId } });
    expect(entries).toHaveLength(1);
  });

  it("6. locates the existing conversation on a second message from the same customer", async () => {
    const gateway = createWhatsAppGateway({ runAnalysis: makeRunAnalysis(db!) }, db!);
    const from = "16315557777";

    const first = await gateway.handleInboundMessage({
      externalId: `wamid.SEQ1-${Date.now()}`,
      phoneNumberId: fixture.phoneNumberId,
      fromPhoneNumber: from,
      messageType: "TEXT",
      content: "Hola",
      occurredAt: new Date(),
      raw: {},
    });
    const second = await gateway.handleInboundMessage({
      externalId: `wamid.SEQ2-${Date.now()}`,
      phoneNumberId: fixture.phoneNumberId,
      fromPhoneNumber: from,
      messageType: "TEXT",
      content: "¿Tienen disponible?",
      occurredAt: new Date(),
      raw: {},
    });

    expect(second.conversationId).toBe(first.conversationId);

    const entries = await db!.conversationEntry.findMany({ where: { conversationId: first.conversationId! } });
    expect(entries).toHaveLength(2);
  });

  it("14. resolves the lead's assigned advisor from the real Lead row", async () => {
    const gateway = createWhatsAppGateway({ runAnalysis: makeRunAnalysis(db!) }, db!);
    const from = "16315556666";

    // First message creates the lead unassigned...
    const first = await gateway.handleInboundMessage({
      externalId: `wamid.ADV1-${Date.now()}`,
      phoneNumberId: fixture.phoneNumberId,
      fromPhoneNumber: from,
      messageType: "TEXT",
      content: "Hola",
      occurredAt: new Date(),
      raw: {},
    });
    expect(first.advisorUserId).toBeNull();

    // ...then an advisor is assigned out of band (e.g. via the CRM UI)...
    await db!.lead.update({ where: { id: first.leadId! }, data: { assignedToUserId: fixture.userId } });

    // ...and the next inbound message reflects that assignment.
    const second = await gateway.handleInboundMessage({
      externalId: `wamid.ADV2-${Date.now()}`,
      phoneNumberId: fixture.phoneNumberId,
      fromPhoneNumber: from,
      messageType: "TEXT",
      content: "¿Sigue disponible?",
      occurredAt: new Date(),
      raw: {},
    });
    expect(second.advisorUserId).toBe(fixture.userId);
  });

  it("handleStatusEvent persists a delivery status against a real pending message", async () => {
    const gateway = createWhatsAppGateway({ runAnalysis: makeRunAnalysis(db!) }, db!);

    const pending = await gateway.enqueueOutboundMessage({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      whatsappPhoneNumberId: fixture.whatsappPhoneNumberId,
      toPhoneNumber: "+10000000002",
      body: "Hola",
    });
    await db!.pendingWhatsAppMessage.update({
      where: { id: pending.id },
      data: { status: "READY" },
    });
    const sent = await db!.pendingWhatsAppMessage.update({
      where: { id: pending.id },
      data: { status: "SENT", externalId: `wamid.OUT-${Date.now()}`, sentAt: new Date() },
    });

    const status: NormalizedWhatsAppStatus = {
      externalId: sent.externalId!,
      phoneNumberId: fixture.phoneNumberId,
      recipientPhoneNumber: "+10000000002",
      status: "DELIVERED",
      occurredAt: new Date(),
      raw: {},
    };

    const result = await gateway.handleStatusEvent(status);
    expect(result.applied).toBe(true);

    const events = await db!.whatsAppMessageStatusEvent.findMany({ where: { pendingMessageId: pending.id } });
    expect(events.map((e) => e.status)).toContain("DELIVERED");
  });
});
