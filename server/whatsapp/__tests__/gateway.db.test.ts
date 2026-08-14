// Gated: proves the real (non-faked) WhatsAppGateway — real lead-service,
// real conversation-service, real queue.ts, real orchestration with a mocked
// AI provider — against sales_os_test only. Every default dependency is
// bound to the test PrismaClient via createWhatsAppGateway(overrides, db);
// the only thing overridden is runAnalysis, since the default reaches for
// the app's composition-root singletons (AI_PROVIDER env + the shared
// prisma client), which this test deliberately never touches.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withAnalysisRunLock } from "../../application/analysis-run-lock";
import { AnalysisInProgressError } from "../../application/errors";
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
        // Safety net for a test that times out mid-run (e.g. the analysis
        // concurrency test below) — withAnalysisRunLock's own `finally`
        // normally releases this, but a timed-out test can abandon that.
        await db!.conversationAnalysisRun.deleteMany({ where: { conversationId: { in: conversationIds } } });
        await db!.decisionEvent.deleteMany({ where: { decisionRecord: { conversationId: { in: conversationIds } } } });
        await db!.decisionRecord.deleteMany({ where: { conversationId: { in: conversationIds } } });
        await db!.conversationSnapshot.deleteMany({ where: { conversationId: { in: conversationIds } } });
        // Observer Mode v1 — observations reference domainEvents, so they're
        // deleted first even though both hang directly off the conversation.
        await db!.observation.deleteMany({ where: { conversationId: { in: conversationIds } } });
        await db!.domainEvent.deleteMany({ where: { conversationId: { in: conversationIds } } });
        await db!.conversationEntry.deleteMany({ where: { conversationId: { in: conversationIds } } });
      }
      await db!.conversation.deleteMany({ where: { leadId: lead.id } });
      // Kori Natural Language Analytics v0 Phase 1 — no cascade delete off
      // Lead, and this suite's default gateway (unlike most others) doesn't
      // override projectCommercialProfile, so a real row is likely here.
      await db!.leadCommercialProfile.deleteMany({ where: { leadId: lead.id } });
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

    // Kori Natural Language Analytics v0 Phase 1 — minimalProviderResult's
    // facts/inferences are all null (tier 2 contributes nothing), so this
    // proves the deterministic Lead Commercial State (tier 3) alone
    // produced a real, persisted profile — "Hilux" is in
    // KNOWN_VEHICLE_MODELS (freetext-product-extractor.ts).
    expect(result.profileProjected).toBe(true);
    expect(result.profileProjectionError).toBeUndefined();
    const profile = await db!.leadCommercialProfile.findUnique({ where: { leadId: result.leadId! } });
    expect(profile?.vehicleModel).toContain("Hilux");
  });

  it("8. Kori Natural Language Analytics v0 robustness fix: profile projection runs and persists even when the AI provider is not configured — the exact production root cause reproduced end to end", async () => {
    const unconfiguredRunAnalysis = async () => {
      throw new Error("AI_PROVIDER is not configured. Set it in your environment (see .env.example).");
    };
    const gateway = createWhatsAppGateway({ runAnalysis: unconfiguredRunAnalysis }, db!);

    const message: NormalizedWhatsAppMessage = {
      externalId: `wamid.NOAI-${Date.now()}`,
      phoneNumberId: fixture.phoneNumberId,
      fromPhoneNumber: "16315557766",
      messageType: "TEXT",
      content: "Hola, tengo una Toyota Hilux 2022 y quiero comprar el body kit TRAVO. ¿Cuánto cuesta?",
      occurredAt: new Date(),
      raw: {},
    };

    const result = await gateway.handleInboundMessage(message);

    // Message persistence — the critical path — is entirely unaffected.
    expect(result.duplicate).toBe(false);
    const entry = await db!.conversationEntry.findUnique({ where: { externalId: message.externalId } });
    expect(entry).not.toBeNull();

    // Analysis genuinely failed, exactly as it does in production today...
    expect(result.analysisTriggered).toBe(false);
    expect(result.analysisError).toBeInstanceOf(Error);
    expect((result.analysisError as Error).message).toContain("AI_PROVIDER is not configured");
    // No ConversationSnapshot was ever created — analysis never reached that point.
    const snapshots = await db!.conversationSnapshot.findMany({ where: { conversationId: result.conversationId! } });
    expect(snapshots).toHaveLength(0);

    // ...but the commercial profile is still projected via tier-3 deterministic
    // extraction alone, and actually persisted to production-shaped data.
    expect(result.profileProjected).toBe(true);
    expect(result.profileProjectionError).toBeUndefined();
    const profile = await db!.leadCommercialProfile.findUnique({ where: { leadId: result.leadId! } });
    expect(profile).not.toBeNull();
    expect(profile?.vehicleModel).toContain("Hilux");
    expect(profile?.productInterest).toBeTruthy();
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

  it("Step 2 — never creates duplicate DecisionRecords when two inbound messages trigger overlapping analysis on the same conversation (real withAnalysisRunLock, real unique-constraint guard)", async () => {
    // Mirrors defaultRunAnalysis's real production wiring (gateway.ts) —
    // withAnalysisRunLock wrapping analyzeConversationAndCreateDecisions —
    // but with a mocked AI provider and this suite's test db, same
    // reasoning as makeRunAnalysis above (the real default always reaches
    // for composition-root's singletons, which this suite never touches).
    let releaseFirst!: () => void;
    const firstIsRunning = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    let raceCallCount = 0;

    const lockedRunAnalysis = (input: Parameters<typeof analyzeConversationAndCreateDecisions>[0]) =>
      withAnalysisRunLock(
        input.businessId,
        input.conversationId,
        async () => {
          raceCallCount += 1;
          if (raceCallCount === 1) {
            firstStarted();
            await firstIsRunning; // block until the second attempt has raced in and failed
          }
          const mock = createMockAIProvider({
            response: () => JSON.stringify(minimalProviderResult()),
            decisionReasoningResponse: () => JSON.stringify({ decisions: [decisionProposal("Confirm compatibility")] }),
          });
          return analyzeConversationAndCreateDecisions(input, {
            aiProvider: mock.provider,
            transactionRunner: new PrismaTransactionRunner(db!),
          });
        },
        db!,
      );

    // A separate, non-blocking gateway just to seed the lead+conversation —
    // using the race gateway here too would make the seed message itself
    // the "first" (blocking) lockedRunAnalysis call and deadlock before the
    // race even starts. Both gateways share the same `db`/business/lead;
    // which gateway instance issues a call doesn't matter to the underlying
    // state, only which `runAnalysis` implementation it's wired to. Zero
    // decisions here (unlike makeRunAnalysis's default fixture) so the
    // seed's own real, independent analysis doesn't inflate the decision
    // count this test is asserting on below.
    const seedMock = createMockAIProvider({ response: () => JSON.stringify(minimalProviderResult()), decisionReasoningResponse: () => JSON.stringify({ decisions: [] }) });
    const seedGateway = createWhatsAppGateway(
      {
        runAnalysis: (input) =>
          withAnalysisRunLock(
            input.businessId,
            input.conversationId,
            () => analyzeConversationAndCreateDecisions(input, { aiProvider: seedMock.provider, transactionRunner: new PrismaTransactionRunner(db!) }),
            db!,
          ),
      },
      db!,
    );
    const gateway = createWhatsAppGateway({ runAnalysis: lockedRunAnalysis }, db!);
    const from = "16315556655";

    // Establish the lead+conversation first (sequential — the conversation
    // row itself isn't what this test is about).
    const seed = await seedGateway.handleInboundMessage({
      externalId: `wamid.LOCK-SEED-${Date.now()}`,
      phoneNumberId: fixture.phoneNumberId,
      fromPhoneNumber: from,
      messageType: "TEXT",
      content: "Hola",
      occurredAt: new Date(),
      raw: {},
    });

    const firstMessage = gateway.handleInboundMessage({
      externalId: `wamid.LOCK-A-${Date.now()}`,
      phoneNumberId: fixture.phoneNumberId,
      fromPhoneNumber: from,
      messageType: "TEXT",
      content: "Tengo una Hilux 2022",
      occurredAt: new Date(),
      raw: {},
    });

    await firstStartedPromise; // first attempt now holds the lock

    const secondMessage = await gateway.handleInboundMessage({
      externalId: `wamid.LOCK-B-${Date.now()}`,
      phoneNumberId: fixture.phoneNumberId,
      fromPhoneNumber: from,
      messageType: "TEXT",
      content: "¿Cuánto cuesta?",
      occurredAt: new Date(),
      raw: {},
    });

    // The message itself is still persisted — only analysis was rejected.
    expect(secondMessage.duplicate).toBe(false);
    expect(secondMessage.analysisTriggered).toBe(false);
    expect(secondMessage.analysisError).toBeInstanceOf(AnalysisInProgressError);

    releaseFirst();
    const firstResult = await firstMessage;
    expect(firstResult.analysisTriggered).toBe(true);
    expect(firstResult.analysisError).toBeUndefined();

    // Exactly one successful analysis ran for this conversation — no
    // duplicate DecisionRecord/ConversationSnapshot from the overlap.
    const decisions = await db!.decisionRecord.findMany({ where: { conversationId: seed.conversationId! } });
    expect(decisions).toHaveLength(1);
    const snapshots = await db!.conversationSnapshot.findMany({ where: { conversationId: seed.conversationId! } });
    expect(snapshots).toHaveLength(1);
    expect(raceCallCount).toBe(1); // the lock rejected the second attempt before its work function ever ran

    const runs = await db!.conversationAnalysisRun.findMany({ where: { conversationId: seed.conversationId! } });
    expect(runs).toHaveLength(0); // released after completion
  }, 15_000);

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

  it("Coexistence: a business-app echo round-trips into a real OUTBOUND ConversationEntry", async () => {
    const gateway = createWhatsAppGateway({ runAnalysis: makeRunAnalysis(db!) }, db!);

    const result = await gateway.handleBusinessAppEchoEvent({
      externalId: `wamid.ECHO-${Date.now()}`,
      phoneNumberId: fixture.phoneNumberId,
      toPhoneNumber: "16315559999",
      subtype: "NEW",
      messageType: "TEXT",
      content: "En camino con el kit.",
      occurredAt: new Date(),
      raw: {},
    });

    expect(result.duplicate).toBe(false);
    expect(result.businessId).toBe(fixture.businessId);

    const entry = await db!.conversationEntry.findUnique({ where: { id: result.entryId! } });
    expect(entry?.direction).toBe("OUTBOUND");
    expect(entry?.content).toBe("En camino con el kit.");
  });

  it("Coexistence: a redelivered echo is a no-op against the real unique constraint", async () => {
    const gateway = createWhatsAppGateway({ runAnalysis: makeRunAnalysis(db!) }, db!);
    const echo = {
      externalId: `wamid.ECHODUP-${Date.now()}`,
      phoneNumberId: fixture.phoneNumberId,
      toPhoneNumber: "16315558888",
      subtype: "NEW" as const,
      messageType: "TEXT" as const,
      content: "Hola",
      occurredAt: new Date(),
      raw: {},
    };

    const first = await gateway.handleBusinessAppEchoEvent(echo);
    const second = await gateway.handleBusinessAppEchoEvent(echo);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);

    const entries = await db!.conversationEntry.findMany({ where: { externalId: echo.externalId } });
    expect(entries).toHaveLength(1);
  });
});
