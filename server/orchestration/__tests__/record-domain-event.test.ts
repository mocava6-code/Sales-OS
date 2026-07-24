import { describe, expect, it } from "vitest";
import type { MessageReceivedEvent } from "../../domain-events/types";
import { recordDomainEvent } from "../record-domain-event";
import { createFakeTransactionRunner } from "./fakes";

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

describe("recordDomainEvent", () => {
  it("persists the DomainEvent even when no observation is derived", async () => {
    const { runner, store } = createFakeTransactionRunner();

    const result = await recordDomainEvent(
      { event: messageReceived({ content: "hola, buenos dias" }), conversationEntryId: "entry-1" },
      { transactionRunner: runner },
    );

    expect(result.observations).toEqual([]);
    expect(store.domainEvents.size).toBe(1);
    const [savedEvent] = [...store.domainEvents.values()];
    expect(savedEvent.eventType).toBe("MESSAGE_RECEIVED");
    expect(savedEvent.conversationEntryId).toBe("entry-1");
    expect(store.observations.size).toBe(0);
  });

  it("persists both the DomainEvent and every derived Observation, linked together", async () => {
    const { runner, store } = createFakeTransactionRunner();

    const result = await recordDomainEvent(
      { event: messageReceived({ content: "cuánto cuesta con descuento?" }), conversationEntryId: "entry-7" },
      { transactionRunner: runner },
    );

    expect(result.observations.length).toBeGreaterThanOrEqual(2);
    const types = result.observations.map((o) => o.observation.type);
    expect(types).toContain("PRICE_REQUEST");
    expect(types).toContain("DISCOUNT_NEGOTIATION");

    for (const observation of result.observations) {
      expect(observation.domainEventId).toBe(result.domainEvent.id);
      expect(observation.conversationId).toBe("conv-1");
      expect(observation.businessId).toBe("biz-1");
    }
    expect(store.observations.size).toBe(result.observations.length);
  });

  it("rolls back everything if persisting an observation fails partway through", async () => {
    const { runner, store } = createFakeTransactionRunner({
      observations: (base) => ({
        ...base,
        save: async () => {
          throw new Error("boom");
        },
      }),
    });

    await expect(
      recordDomainEvent(
        { event: messageReceived({ content: "precio?" }), conversationEntryId: "entry-1" },
        { transactionRunner: runner },
      ),
    ).rejects.toThrow();

    expect(store.domainEvents.size).toBe(0);
    expect(store.observations.size).toBe(0);
  });
});
