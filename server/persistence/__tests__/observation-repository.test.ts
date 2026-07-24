import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Observation } from "../../intelligence/observation/types";
import { PrismaDomainEventRepository } from "../prisma/prisma-domain-event-repository";
import { PrismaObservationRepository } from "../prisma/prisma-observation-repository";
import { cleanupTestFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "./test-db";

describe.skipIf(!shouldRunDbTests)("PrismaObservationRepository (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  const domainEventRepo = db ? new PrismaDomainEventRepository(db) : undefined;
  const repo = db ? new PrismaObservationRepository(db) : undefined;
  let fixture: TestFixture;
  let domainEventId: string;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "observation");
    const savedEvent = await domainEventRepo!.append({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      conversationEntryId: "entry-1",
      event: {
        type: "MESSAGE_RECEIVED",
        businessId: fixture.businessId,
        conversationId: fixture.conversationId,
        conversationEntryId: "entry-1",
        messageType: "TEXT",
        content: "cuánto cuesta con descuento?",
        occurredAt: new Date("2026-07-20T12:00:00.000Z"),
      },
    });
    domainEventId = savedEvent.id;
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
  });

  function observation(overrides: Partial<Observation> = {}): Observation {
    return {
      type: "PRICE_REQUEST",
      summary: "Customer asked about price.",
      evidence: [{ sourceType: "conversation_message", sourceId: "entry-1", excerpt: "cuánto cuesta con descuento?" }],
      ...overrides,
    };
  }

  it("saves an observation linked to its DomainEvent and lists it back, verbatim", async () => {
    const saved = await repo!.save({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      domainEventId,
      conversationEntryId: "entry-1",
      observation: observation(),
      occurredAt: new Date("2026-07-20T12:00:00.000Z"),
    });

    expect(saved.id).toBeTruthy();
    expect(saved.domainEventId).toBe(domainEventId);
    expect(saved.observation).toEqual(observation());

    const history = await repo!.listForConversation(fixture.conversationId);
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(saved.id);
  });

  it("supports multiple independent observations from the same DomainEvent, chronological and never aggregated", async () => {
    // Distinct timestamps — this test is about chronological ordering, not
    // the id tie-break (see the dedicated test below for that).
    await repo!.save({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      domainEventId,
      observation: observation({ type: "PRICE_REQUEST" }),
      occurredAt: new Date("2026-07-20T12:00:00.000Z"),
    });
    await repo!.save({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      domainEventId,
      observation: observation({ type: "DISCOUNT_NEGOTIATION", summary: "Customer asked for a discount." }),
      occurredAt: new Date("2026-07-20T12:00:01.000Z"),
    });

    const history = await repo!.listForConversation(fixture.conversationId);

    expect(history.map((o) => o.observation.type)).toEqual(["PRICE_REQUEST", "DISCOUNT_NEGOTIATION"]);
  });

  it("breaks ties on occurredAt by id asc, deterministically — never insertion order or physical storage order", async () => {
    const tiedOccurredAt = new Date("2026-07-20T12:00:00.000Z");
    const first = await repo!.save({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      domainEventId,
      observation: observation({ type: "PRICE_REQUEST" }),
      occurredAt: tiedOccurredAt,
    });
    const second = await repo!.save({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      domainEventId,
      observation: observation({ type: "DISCOUNT_NEGOTIATION" }),
      occurredAt: tiedOccurredAt,
    });

    const history = await repo!.listForConversation(fixture.conversationId);
    const expectedOrder = [first.id, second.id].sort();

    expect(history.map((o) => o.id)).toEqual(expectedOrder);
  });

  it("aggregateByType returns count and lastSeenAt per type, scoped to the business, absent for never-observed types", async () => {
    await repo!.save({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      domainEventId,
      observation: observation({ type: "PRICE_REQUEST" }),
      occurredAt: new Date("2026-07-20T12:00:00.000Z"),
    });
    await repo!.save({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      domainEventId,
      observation: observation({ type: "PRICE_REQUEST" }),
      occurredAt: new Date("2026-07-22T09:00:00.000Z"),
    });
    await repo!.save({
      businessId: fixture.businessId,
      conversationId: fixture.conversationId,
      domainEventId,
      observation: observation({ type: "DISCOUNT_NEGOTIATION" }),
      occurredAt: new Date("2026-07-21T09:00:00.000Z"),
    });

    const aggregates = await repo!.aggregateByType(fixture.businessId);
    const byType = new Map(aggregates.map((a) => [a.type, a]));

    expect(byType.get("PRICE_REQUEST")).toMatchObject({ count: 2, lastSeenAt: new Date("2026-07-22T09:00:00.000Z") });
    expect(byType.get("DISCOUNT_NEGOTIATION")).toMatchObject({ count: 1, lastSeenAt: new Date("2026-07-21T09:00:00.000Z") });
    // CUSTOMER_GHOSTED, COMPATIBILITY_QUESTION, etc. never observed — absent, not zero-filled.
    expect(byType.has("CUSTOMER_GHOSTED")).toBe(false);
  });
});
