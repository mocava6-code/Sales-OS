import { describe, expect, it } from "vitest";
import type { ConversationClosedEvent, MessageReceivedEvent } from "../../../domain-events/types";
import { deriveObservations } from "../observe";
import { GHOSTING_THRESHOLD_HOURS } from "../detectors/ghosting-detector";

function messageReceived(overrides: Partial<MessageReceivedEvent> = {}): MessageReceivedEvent {
  return {
    type: "MESSAGE_RECEIVED",
    businessId: "biz-1",
    conversationId: "conv-1",
    conversationEntryId: "entry-1",
    messageType: "TEXT",
    content: "hola",
    occurredAt: new Date("2026-01-01T12:00:00Z"),
    ...overrides,
  };
}

describe("deriveObservations — keyword detectors", () => {
  it("returns no observations for an ordinary message", () => {
    expect(deriveObservations(messageReceived({ content: "hola, buenos dias" }))).toEqual([]);
  });

  it.each([
    ["es", "¿Cuánto cuesta el kit completo?"],
    ["pt", "Quanto custa o kit completo?"],
    ["en", "How much does the full kit cost?"],
  ])("detects PRICE_REQUEST (%s)", (_lang, content) => {
    const observations = deriveObservations(messageReceived({ content }));
    expect(observations.map((o) => o.type)).toContain("PRICE_REQUEST");
  });

  it("detects COMPATIBILITY_QUESTION", () => {
    const observations = deriveObservations(messageReceived({ content: "¿Es compatible con un Corolla 2018?" }));
    expect(observations.map((o) => o.type)).toContain("COMPATIBILITY_QUESTION");
  });

  it("detects INSTALLATION_QUESTION", () => {
    const observations = deriveObservations(messageReceived({ content: "Como faço para instalar isso?" }));
    expect(observations.map((o) => o.type)).toContain("INSTALLATION_QUESTION");
  });

  it("detects PHOTO_REQUEST", () => {
    const observations = deriveObservations(messageReceived({ content: "me mandas una foto?" }));
    expect(observations.map((o) => o.type)).toContain("PHOTO_REQUEST");
  });

  it("detects DISCOUNT_NEGOTIATION", () => {
    const observations = deriveObservations(messageReceived({ content: "tienes algun descuento?" }));
    expect(observations.map((o) => o.type)).toContain("DISCOUNT_NEGOTIATION");
  });

  it("detects multiple independent observations in one message", () => {
    const observations = deriveObservations(messageReceived({ content: "cuánto cuesta con descuento?" }));
    const types = observations.map((o) => o.type);
    expect(types).toContain("PRICE_REQUEST");
    expect(types).toContain("DISCOUNT_NEGOTIATION");
  });

  it("every observation carries grounding evidence pointing at the source entry", () => {
    const observations = deriveObservations(messageReceived({ content: "precio?", conversationEntryId: "entry-42" }));
    expect(observations.length).toBeGreaterThan(0);
    for (const observation of observations) {
      expect(observation.evidence[0]).toMatchObject({ sourceType: "conversation_message", sourceId: "entry-42" });
    }
  });
});

describe("deriveObservations — business intelligence mission: intent signals", () => {
  it.each([
    ["QUOTE_REQUEST", "me puedes cotizar el kit completo?"],
    ["AVAILABILITY_REQUEST", "tienen stock del kit?"],
    ["DELIVERY_TIME_REQUEST", "en que tiempo lo hacen?"],
    ["PAYMENT_METHOD_REQUEST", "como pago, tienen yape?"],
  ])("detects %s", (type, content) => {
    const observations = deriveObservations(messageReceived({ content }));
    expect(observations.map((o) => o.type)).toContain(type);
  });
});

describe("deriveObservations — business intelligence mission: friction signals", () => {
  it.each([
    ["PRICE_OBJECTION", "esta muy caro para mi"],
    ["AVAILABILITY_FRICTION", "no hay stock del kit que quiero"],
    ["DELIVERY_LOCATION_FRICTION", "no hacen envios a mi ciudad?"],
    ["INSTALLATION_FRICTION", "no instalan en mi zona"],
    ["TRUST_FRICTION", "es confiable esta tienda?"],
    ["TIMING_FRICTION", "estan muy lento respondiendo"],
  ])("detects %s", (type, content) => {
    const observations = deriveObservations(messageReceived({ content }));
    expect(observations.map((o) => o.type)).toContain(type);
  });

  it("distinguishes a neutral price question (PRICE_REQUEST) from an objection (PRICE_OBJECTION)", () => {
    const neutral = deriveObservations(messageReceived({ content: "cuanto cuesta el kit?" }));
    const objection = deriveObservations(messageReceived({ content: "esta muy caro" }));
    expect(neutral.map((o) => o.type)).toContain("PRICE_REQUEST");
    expect(neutral.map((o) => o.type)).not.toContain("PRICE_OBJECTION");
    expect(objection.map((o) => o.type)).toContain("PRICE_OBJECTION");
  });
});

describe("deriveObservations — business intelligence mission: geography signals", () => {
  it("detects LIMA_MENTIONED for Lima and known Lima districts", () => {
    expect(deriveObservations(messageReceived({ content: "vivo en Miraflores" })).map((o) => o.type)).toContain("LIMA_MENTIONED");
  });

  it("detects PROVINCE_MENTIONED for provincia and known regions outside Lima", () => {
    expect(deriveObservations(messageReceived({ content: "le escribo desde Ayacucho" })).map((o) => o.type)).toContain("PROVINCE_MENTIONED");
    expect(deriveObservations(messageReceived({ content: "hacen envios a provincia?" })).map((o) => o.type)).toContain("PROVINCE_MENTIONED");
  });

  it("does not cross-fire Lima and province for an unrelated message", () => {
    const observations = deriveObservations(messageReceived({ content: "hola, buenos dias" }));
    expect(observations.map((o) => o.type)).not.toContain("LIMA_MENTIONED");
    expect(observations.map((o) => o.type)).not.toContain("PROVINCE_MENTIONED");
  });
});

describe("deriveObservations — CUSTOMER_GHOSTED", () => {
  it("does not flag a prompt reply", () => {
    const event = messageReceived({
      previousEntry: { direction: "INBOUND", occurredAt: new Date("2026-01-01T11:00:00Z") },
    });
    expect(deriveObservations(event).map((o) => o.type)).not.toContain("CUSTOMER_GHOSTED");
  });

  it("does not flag when the previous entry was OUTBOUND (the advisor answered)", () => {
    const event = messageReceived({
      occurredAt: new Date("2026-01-05T12:00:00Z"),
      previousEntry: { direction: "OUTBOUND", occurredAt: new Date("2026-01-01T12:00:00Z") },
    });
    expect(deriveObservations(event).map((o) => o.type)).not.toContain("CUSTOMER_GHOSTED");
  });

  it("flags CUSTOMER_GHOSTED when a customer replies after a long INBOUND silence", () => {
    const event = messageReceived({
      occurredAt: new Date("2026-01-03T13:00:00Z"),
      previousEntry: { direction: "INBOUND", occurredAt: new Date("2026-01-01T12:00:00Z") },
    });
    expect(deriveObservations(event).map((o) => o.type)).toContain("CUSTOMER_GHOSTED");
  });

  it("flags CUSTOMER_GHOSTED on close when the advisor's last message went unanswered past the threshold", () => {
    const lastEntryAt = new Date("2026-01-01T12:00:00Z");
    const event: ConversationClosedEvent = {
      type: "CONVERSATION_CLOSED",
      businessId: "biz-1",
      conversationId: "conv-1",
      lastEntryDirection: "OUTBOUND",
      lastEntryAt,
      occurredAt: new Date(lastEntryAt.getTime() + (GHOSTING_THRESHOLD_HOURS + 1) * 60 * 60 * 1000),
    };
    expect(deriveObservations(event).map((o) => o.type)).toContain("CUSTOMER_GHOSTED");
  });

  it("does not flag on close when the last entry was INBOUND (nothing for the advisor to have answered)", () => {
    const lastEntryAt = new Date("2026-01-01T12:00:00Z");
    const event: ConversationClosedEvent = {
      type: "CONVERSATION_CLOSED",
      businessId: "biz-1",
      conversationId: "conv-1",
      lastEntryDirection: "INBOUND",
      lastEntryAt,
      occurredAt: new Date(lastEntryAt.getTime() + (GHOSTING_THRESHOLD_HOURS + 1) * 60 * 60 * 1000),
    };
    expect(deriveObservations(event).map((o) => o.type)).not.toContain("CUSTOMER_GHOSTED");
  });
});
