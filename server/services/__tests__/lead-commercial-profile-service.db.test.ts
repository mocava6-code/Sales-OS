// Gated: proves computeLeadCommercialProfileUpdate/projectLeadCommercialProfile
// against real Postgres (sales_os_test) — precedence, confidence-based
// overwrite protection, idempotency, tenant isolation, the nextAction
// tier-3-only deviation, and the zero-conversation safe no-op.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@/server/db/generated/client";
import { computeLeadCommercialProfileUpdate, projectLeadCommercialProfile } from "../lead-commercial-profile-service";
import {
  cleanupTestFixture,
  createTestFixture,
  getTestPrisma,
  shouldRunDbTests,
  type TestFixture,
} from "../../persistence/__tests__/test-db";

function fact(value: unknown, confidence: number) {
  return { kind: "fact", value, confidence, evidence: [] };
}

function inference(value: unknown, confidence: number) {
  return { kind: "inference", value, confidence, evidence: [] };
}

const NULL_FACTS = {
  customerName: fact(null, 0),
  customerContact: fact(null, 0),
  vehicleBrand: fact(null, 0),
  vehicleModel: fact(null, 0),
  vehicleYear: fact(null, 0),
  city: fact(null, 0),
  quantity: fact(null, 0),
  productRequested: fact(null, 0),
};

const NULL_INFERENCES = {
  customerType: inference(null, 0),
  productFamily: inference(null, 0),
  compatibility: inference(null, 0),
  buyingIntent: inference(null, 0),
  sentiment: inference(null, 0),
  estimatedProbabilityOfPurchase: inference(null, 0),
  estimatedDealValue: inference(null, 0),
  recommendedNextAction: inference(null, 0),
  aiPriority: inference(null, 0),
};

async function createSnapshot(
  db: ReturnType<typeof getTestPrisma>,
  fixture: TestFixture,
  overrides: { facts?: Record<string, unknown>; inferences?: Record<string, unknown>; objections?: unknown[] } = {},
) {
  return db.conversationSnapshot.create({
    data: {
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      customerIdentification: { isExistingCustomer: false, matchedLeadId: null, matchConfidence: 0, matchEvidence: [] } as Prisma.InputJsonValue,
      facts: { ...NULL_FACTS, ...overrides.facts } as Prisma.InputJsonValue,
      inferences: { ...NULL_INFERENCES, ...overrides.inferences } as Prisma.InputJsonValue,
      objections: (overrides.objections ?? []) as Prisma.InputJsonValue,
      missingInformation: [] as Prisma.InputJsonValue,
      warnings: [] as Prisma.InputJsonValue,
      overallConfidence: 0.8,
      engineSchemaVersion: 1,
      promptVersion: "test",
      aiProvider: "test",
      modelName: "test",
      analyzedAt: new Date(),
    },
  });
}

describe.skipIf(!shouldRunDbTests)("lead-commercial-profile-service (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "commercial-profile");
  });

  afterEach(async () => {
    await db!.conversationSnapshot.deleteMany({ where: { conversationId: fixture.conversationId } });
    await cleanupTestFixture(db!, fixture);
  });

  it("creates a profile from a fresh snapshot", async () => {
    await createSnapshot(db!, fixture, { facts: { vehicleBrand: fact("Toyota", 0.8) } });

    const result = await projectLeadCommercialProfile(fixture.businessId, fixture.leadId, db!);
    expect(result).toEqual({ created: true, updated: false, skipped: false });

    const profile = await db!.leadCommercialProfile.findUnique({ where: { leadId: fixture.leadId } });
    expect(profile?.vehicleBrand).toBe("Toyota");
    expect((profile?.provenance as never as { vehicleBrand: { source: string } }).vehicleBrand.source).toBe("CONVERSATION_SNAPSHOT");
  });

  it("updates the profile when a newer, higher-confidence snapshot arrives", async () => {
    await createSnapshot(db!, fixture, { facts: { vehicleBrand: fact("Toyota", 0.7) } });
    await projectLeadCommercialProfile(fixture.businessId, fixture.leadId, db!);

    await createSnapshot(db!, fixture, { facts: { vehicleBrand: fact("Toyota Nueva", 0.9) } });
    const result = await projectLeadCommercialProfile(fixture.businessId, fixture.leadId, db!);

    expect(result).toEqual({ created: false, updated: true, skipped: false });
    const profile = await db!.leadCommercialProfile.findUnique({ where: { leadId: fixture.leadId } });
    expect(profile?.vehicleBrand).toBe("Toyota Nueva");
  });

  it("is idempotent — an unchanged re-run performs zero writes", async () => {
    await createSnapshot(db!, fixture, { facts: { vehicleBrand: fact("Toyota", 0.8) } });
    await projectLeadCommercialProfile(fixture.businessId, fixture.leadId, db!);
    const before = await db!.leadCommercialProfile.findUnique({ where: { leadId: fixture.leadId } });

    const second = await projectLeadCommercialProfile(fixture.businessId, fixture.leadId, db!);

    expect(second).toEqual({ created: false, updated: false, skipped: true });
    const after = await db!.leadCommercialProfile.findUnique({ where: { leadId: fixture.leadId } });
    expect(after?.updatedAt).toEqual(before?.updatedAt);
  });

  it("rejects a new candidate with lower confidence than the existing value", async () => {
    await createSnapshot(db!, fixture, { facts: { vehicleBrand: fact("Toyota", 0.9) } });
    await projectLeadCommercialProfile(fixture.businessId, fixture.leadId, db!);

    // Still above the 0.6 viability threshold, but below the existing 0.9 confidence.
    await createSnapshot(db!, fixture, { facts: { vehicleBrand: fact("Suzuki", 0.65) } });
    const result = await projectLeadCommercialProfile(fixture.businessId, fixture.leadId, db!);

    expect(result.skipped).toBe(true);
    const profile = await db!.leadCommercialProfile.findUnique({ where: { leadId: fixture.leadId } });
    expect(profile?.vehicleBrand).toBe("Toyota");
  });

  it("a null candidate never erases a known existing value", async () => {
    await createSnapshot(db!, fixture, { facts: { vehicleBrand: fact("Toyota", 0.8) } });
    await projectLeadCommercialProfile(fixture.businessId, fixture.leadId, db!);

    await createSnapshot(db!, fixture, { facts: { vehicleBrand: fact(null, 0) } });
    const result = await projectLeadCommercialProfile(fixture.businessId, fixture.leadId, db!);

    expect(result.skipped).toBe(true);
    const profile = await db!.leadCommercialProfile.findUnique({ where: { leadId: fixture.leadId } });
    expect(profile?.vehicleBrand).toBe("Toyota");
  });

  it("tenant isolation — two businesses' projections never cross-contaminate", async () => {
    const other = await createTestFixture(db!, "commercial-profile-other");
    try {
      await createSnapshot(db!, fixture, { facts: { vehicleBrand: fact("Toyota", 0.8) } });
      await createSnapshot(db!, other, { facts: { vehicleBrand: fact("Ford", 0.8) } });

      await projectLeadCommercialProfile(fixture.businessId, fixture.leadId, db!);
      await projectLeadCommercialProfile(other.businessId, other.leadId, db!);

      const mine = await db!.leadCommercialProfile.findUnique({ where: { leadId: fixture.leadId } });
      const theirs = await db!.leadCommercialProfile.findUnique({ where: { leadId: other.leadId } });
      expect(mine?.vehicleBrand).toBe("Toyota");
      expect(mine?.businessId).toBe(fixture.businessId);
      expect(theirs?.vehicleBrand).toBe("Ford");
      expect(theirs?.businessId).toBe(other.businessId);
    } finally {
      await db!.conversationSnapshot.deleteMany({ where: { conversationId: other.conversationId } });
      await db!.leadCommercialProfile.deleteMany({ where: { leadId: other.leadId } });
      await cleanupTestFixture(db!, other);
    }
  });

  it("nextAction is sourced from the deterministic engine only — a free-text tier-2 recommendation never leaks into the enum column", async () => {
    // createTestFixture's conversation defaults to status NEEDS_REPLY with no
    // entries — resolveNextAction's priority order resolves this straight to
    // ANSWER_QUESTION regardless of message content.
    await createSnapshot(db!, fixture, {
      inferences: { recommendedNextAction: inference({ action: "Llamar al cliente mañana por la tarde", reason: "urgente" }, 0.95) },
    });

    const result = await projectLeadCommercialProfile(fixture.businessId, fixture.leadId, db!);
    expect(result.created).toBe(true);

    const profile = await db!.leadCommercialProfile.findUnique({ where: { leadId: fixture.leadId } });
    expect(profile?.nextAction).toBe("ANSWER_QUESTION");
    expect(profile?.nextActionReason).not.toContain("Llamar al cliente");
    expect((profile?.provenance as never as { nextAction: { source: string } }).nextAction.source).toBe("LEAD_COMMERCIAL_STATE");
  });

  it("a lead with zero conversations is a safe no-op, never throws", async () => {
    const bareLead = await db!.lead.create({ data: { businessId: fixture.businessId, name: "No Conversations", phone: "+10000000123" } });
    try {
      const computed = await computeLeadCommercialProfileUpdate(fixture.businessId, bareLead.id, db!);
      expect(computed).toEqual({ hasChanges: false, rowExisted: false, fields: {}, provenance: {} });

      const result = await projectLeadCommercialProfile(fixture.businessId, bareLead.id, db!);
      expect(result).toEqual({ created: false, updated: false, skipped: true });

      const profile = await db!.leadCommercialProfile.findUnique({ where: { leadId: bareLead.id } });
      expect(profile).toBeNull();
    } finally {
      await db!.lead.delete({ where: { id: bareLead.id } });
    }
  });

  it("deterministic extraction alone creates a profile when NO ConversationSnapshot exists — the AI-unavailable production scenario", async () => {
    // No createSnapshot call anywhere in this test — proves tier 3
    // (server/intelligence/lead-commercial-state) works entirely from
    // ConversationEntry rows, independent of the LLM engine ever running.
    await db!.conversationEntry.create({
      data: {
        conversationId: fixture.conversationId,
        direction: "INBOUND",
        content: "Hola, tengo una Hilux 2022 y quiero comprar el body kit TRAVO. ¿Cuánto cuesta?",
        occurredAt: new Date(),
      },
    });

    const snapshotCountBefore = await db!.conversationSnapshot.count({ where: { conversationId: fixture.conversationId } });
    expect(snapshotCountBefore).toBe(0);

    const result = await projectLeadCommercialProfile(fixture.businessId, fixture.leadId, db!);
    expect(result).toEqual({ created: true, updated: false, skipped: false });

    const profile = await db!.leadCommercialProfile.findUnique({ where: { leadId: fixture.leadId } });
    expect(profile?.vehicleModel).toBe("Hilux");
    // Kori Data Correctness Phase 1C — vehicleBrand/vehicleYear are now
    // also deterministically populated in this exact AI-unavailable
    // scenario, previously always null with no tier-3 fallback at all.
    expect(profile?.vehicleBrand).toBe("Toyota");
    expect(profile?.vehicleYear).toBe(2022);
    expect(profile?.productInterest).toBe("TRAVO kit");
    // createTestFixture's conversation defaults to status NEEDS_REPLY —
    // nextAction resolves from that alone, no entries required for it specifically.
    expect(profile?.nextAction).toBe("ANSWER_QUESTION");
    expect((profile?.provenance as never as { vehicleModel: { source: string } }).vehicleModel.source).toBe("LEAD_COMMERCIAL_STATE");
    expect((profile?.provenance as never as { vehicleBrand: { source: string } }).vehicleBrand.source).toBe("LEAD_COMMERCIAL_STATE");
  });

  it("the exact real production regression case: a customer's direct 'Cliente final' answer populates customerType via tier 3, with no AI/ConversationSnapshot involved", async () => {
    // Reproduces the real Koriaki conversation verbatim: advisor asks the
    // routine qualifying question, customer answers directly. No
    // ConversationSnapshot exists (matches production: the AI pipeline has
    // never once succeeded for this tenant) — this is the exact gap
    // reported ("100% de tus clientes no tienen este dato" for customerType)
    // even though vehicleBrand/Model/Year already worked via tier 3.
    await db!.conversationEntry.createMany({
      data: [
        {
          conversationId: fixture.conversationId,
          direction: "OUTBOUND",
          content: "¡Hola! ¿Que tal? Le saluda Maria Chaca asesora de Koriaki Import 😊\n¿Coménteme es cliente final o distribuidor?",
          occurredAt: new Date("2026-08-11T18:46:00Z"),
        },
        {
          conversationId: fixture.conversationId,
          direction: "INBOUND",
          content: "Cliente final",
          occurredAt: new Date("2026-08-11T18:47:00Z"),
        },
        {
          conversationId: fixture.conversationId,
          direction: "INBOUND",
          content: "Alex sulca illaconza\n42018952\nAyacucho huamanga\n988882112",
          occurredAt: new Date("2026-08-11T19:09:49Z"),
        },
        {
          conversationId: fixture.conversationId,
          direction: "INBOUND",
          content: "Tengo una Ford Ranger 2017",
          occurredAt: new Date("2026-08-11T19:10:00Z"),
        },
      ],
    });

    const snapshotCountBefore = await db!.conversationSnapshot.count({ where: { conversationId: fixture.conversationId } });
    expect(snapshotCountBefore).toBe(0);

    const result = await projectLeadCommercialProfile(fixture.businessId, fixture.leadId, db!);
    expect(result).toEqual({ created: true, updated: false, skipped: false });

    const profile = await db!.leadCommercialProfile.findUnique({ where: { leadId: fixture.leadId } });
    expect(profile?.customerType).toBe("RETAIL");
    expect(profile?.vehicleBrand).toBe("Ford");
    expect(profile?.vehicleModel).toBe("Ranger");
    expect(profile?.vehicleYear).toBe(2017);
    const provenance = profile?.provenance as never as { customerType: { source: string } };
    expect(provenance.customerType.source).toBe("LEAD_COMMERCIAL_STATE");
    // No sale outcome / decision fabricated — this engine has no concept
    // of one, and none was requested.
    expect(profile?.primaryObjection).toBeNull();
  });

  it("customerType: AI-derived tier 2 wins outright over the deterministic tier-3 candidate when both exist — same precedence as every other overlapping field", async () => {
    await createSnapshot(db!, fixture, { inferences: { customerType: inference("WHOLESALE", 0.8) } });
    await projectLeadCommercialProfile(fixture.businessId, fixture.leadId, db!);

    // A deterministic RETAIL signal arrives later — must not overwrite the
    // higher-precedence AI value already stored.
    await db!.conversationEntry.create({
      data: { conversationId: fixture.conversationId, direction: "INBOUND", content: "Cliente final", occurredAt: new Date() },
    });

    const result = await projectLeadCommercialProfile(fixture.businessId, fixture.leadId, db!);

    const profile = await db!.leadCommercialProfile.findUnique({ where: { leadId: fixture.leadId } });
    expect(profile?.customerType).toBe("WHOLESALE");
    expect((profile?.provenance as never as { customerType: { source: string } }).customerType.source).toBe("CONVERSATION_SNAPSHOT");
    expect(result.updated).toBe(false); // the only candidate this run was rejected — no real change
  });

  it("Kori Data Correctness Phase 1C — deterministic vehicleBrand NEVER overwrites a higher-confidence AI-derived vehicleBrand already stored", async () => {
    // A higher-confidence AI snapshot already set vehicleBrand — same
    // precedence mechanism proven generically above for the pre-existing
    // vehicleBrand field, now exercised specifically against the NEW
    // deterministic tier-3 source this phase adds.
    await createSnapshot(db!, fixture, { facts: { vehicleBrand: fact("Suzuki", 0.9) } });
    await projectLeadCommercialProfile(fixture.businessId, fixture.leadId, db!);

    // A message a human would read as "Ford Ranger" — the deterministic
    // extractor would resolve vehicleBrand="Ford" at confidence 0.6, well
    // below the existing 0.9 — must be rejected, not silently applied.
    await db!.conversationEntry.create({
      data: { conversationId: fixture.conversationId, direction: "INBOUND", content: "tienen para mi ranger?", occurredAt: new Date() },
    });

    const result = await projectLeadCommercialProfile(fixture.businessId, fixture.leadId, db!);

    const profile = await db!.leadCommercialProfile.findUnique({ where: { leadId: fixture.leadId } });
    expect(profile?.vehicleBrand).toBe("Suzuki");
    expect((profile?.provenance as never as { vehicleBrand: { source: string } }).vehicleBrand.source).toBe("CONVERSATION_SNAPSHOT");
    // vehicleModel has no existing value yet, so the deterministic
    // candidate for THAT field is still accepted — only vehicleBrand's
    // pre-existing higher-confidence value blocks an overwrite.
    expect(result.updated).toBe(true);
    expect(profile?.vehicleModel).toBe("Ranger");
  });

  it("Part 7 — a canonical fact established early in a long conversation survives even after its raw message has fallen out of the AI's bounded context window", async () => {
    // The vehicle mention is the very FIRST message; many filler messages
    // follow so the AI's bounded window (analyze-conversation-input.ts,
    // MAX_ENGINE_INPUT_TRANSCRIPT_CHARS ≈ 12,000 chars) would no longer
    // include it by the time this test runs projectLeadCommercialProfile.
    await db!.conversationEntry.create({
      data: { conversationId: fixture.conversationId, direction: "INBOUND", content: "Hola, tengo una Toyota Hilux 2022 y quiero un kit", occurredAt: new Date("2026-08-01T00:00:00Z") },
    });
    const fillerCount = 80;
    const baseTime = new Date("2026-08-01T00:00:00Z").getTime();
    await db!.conversationEntry.createMany({
      data: Array.from({ length: fillerCount }, (_, i) => ({
        conversationId: fixture.conversationId,
        direction: i % 2 === 0 ? ("INBOUND" as const) : ("OUTBOUND" as const),
        content: `mensaje de relleno numero ${i} sin contenido comercial relevante para esta prueba`.padEnd(200, "."),
        occurredAt: new Date(baseTime + (i + 1) * 60_000),
      })),
    });

    // Confirm the premise: the AI's bounded window genuinely no longer
    // contains the original vehicle-mention message.
    const conversation = await db!.conversation.findUniqueOrThrow({
      where: { id: fixture.conversationId },
      include: { entries: { orderBy: { occurredAt: "asc" } } },
    });
    const { buildEngineInputFromConversation } = await import("../../application/analyze-conversation-input");
    const engineInput = buildEngineInputFromConversation(fixture.businessId, conversation);
    expect(engineInput.messages!.some((m) => m.content.includes("Hilux"))).toBe(false);

    // Tier 3 (deterministic, unbounded, free — server/intelligence/
    // lead-commercial-state/**) still scans the FULL history regardless of
    // what the AI's own bounded window would see.
    const result = await projectLeadCommercialProfile(fixture.businessId, fixture.leadId, db!);
    expect(result).toEqual({ created: true, updated: false, skipped: false });

    const profile = await db!.leadCommercialProfile.findUnique({ where: { leadId: fixture.leadId } });
    expect(profile?.vehicleBrand).toBe("Toyota");
    expect(profile?.vehicleModel).toBe("Hilux");
    expect(profile?.vehicleYear).toBe(2022);
    expect((profile?.provenance as never as { vehicleModel: { source: string } }).vehicleModel.source).toBe("LEAD_COMMERCIAL_STATE");
  });
});
