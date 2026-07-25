import { describe, expect, it } from "vitest";
import { resolveNextAction, type NextActionInput } from "../next-action-resolver";
import type { Fact, Inference } from "../../types";
import type { ConversationCommercialState, PaymentStatus } from "../types";

function fact<T>(value: T | null): Fact<T> {
  return { kind: "fact", value, confidence: value === null ? 0 : 1, evidence: value === null ? [] : [{ sourceType: "conversation_message", sourceId: "e" }] };
}

function inference<T>(value: T | null): Inference<T> {
  return { kind: "inference", value, confidence: value === null ? 0 : 1, evidence: value === null ? [] : [{ sourceType: "conversation_message", sourceId: "e" }] };
}

function baseInput(overrides: Partial<NextActionInput> = {}): NextActionInput {
  return {
    paymentStatus: inference<PaymentStatus>(null),
    conversationState: fact<ConversationCommercialState>("WAITING_ON_CUSTOMER"),
    productInterest: fact<string>(null),
    deliveryLocation: fact<string>(null),
    requestedDeliveryAt: fact<Date>(null),
    ...overrides,
  };
}

describe("resolveNextAction", () => {
  it("worked example: AWAITING_PAYMENT -> CONFIRM_PAYMENT, takes priority over everything else", () => {
    const result = resolveNextAction(
      baseInput({
        paymentStatus: inference<PaymentStatus>("AWAITING_PAYMENT"),
        productInterest: fact("Hilux TRAVO 2026 kit"),
        deliveryLocation: fact("Chaclacayo"),
        requestedDeliveryAt: fact(new Date("2026-07-25T17:00:00Z")),
      }),
    );

    expect(result.value).toBe("CONFIRM_PAYMENT");
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it("NEEDS_REPLY -> ANSWER_QUESTION, even with a pending payment request from an older exchange", () => {
    const result = resolveNextAction(baseInput({ conversationState: fact("NEEDS_REPLY") }));
    expect(result.value).toBe("ANSWER_QUESTION");
  });

  it("PAYMENT_CONFIRMED + location + date -> SCHEDULE_DELIVERY", () => {
    const result = resolveNextAction(
      baseInput({
        paymentStatus: inference<PaymentStatus>("PAYMENT_CONFIRMED"),
        deliveryLocation: fact("Chaclacayo"),
        requestedDeliveryAt: fact(new Date("2026-07-25T17:00:00Z")),
      }),
    );
    expect(result.value).toBe("SCHEDULE_DELIVERY");
  });

  it("PAYMENT_CONFIRMED without delivery details falls through to FOLLOW_UP, not SCHEDULE_DELIVERY", () => {
    const result = resolveNextAction(baseInput({ paymentStatus: inference<PaymentStatus>("PAYMENT_CONFIRMED") }));
    expect(result.value).toBe("FOLLOW_UP");
  });

  it("product discussed, no payment step yet -> SEND_QUOTE", () => {
    const result = resolveNextAction(
      baseInput({ productInterest: fact("Hilux TRAVO 2026 kit"), conversationState: fact("WAITING_ON_CUSTOMER") }),
    );
    expect(result.value).toBe("SEND_QUOTE");
  });

  it("nothing identified but the advisor is waiting -> FOLLOW_UP", () => {
    const result = resolveNextAction(baseInput());
    expect(result.value).toBe("FOLLOW_UP");
  });

  it("a CLOSED conversation with nothing pending -> NONE", () => {
    const result = resolveNextAction(baseInput({ conversationState: fact("CLOSED") }));
    expect(result.value).toBe("NONE");
    expect(result.evidence).toEqual([]);
  });
});
