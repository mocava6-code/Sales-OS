import { describe, expect, it } from "vitest";
import { paymentStatusExtractor } from "../extractors/payment-extractor";
import type { NormalizedMessageForExtraction } from "../types";

function message(overrides: Partial<NormalizedMessageForExtraction> = {}): NormalizedMessageForExtraction {
  return {
    id: "entry-1",
    conversationId: "conv-1",
    direction: "OUTBOUND",
    content: "",
    occurredAt: new Date("2026-07-24T12:00:00Z"),
    ...overrides,
  };
}

describe("paymentStatusExtractor", () => {
  it("detects AWAITING_PAYMENT from the worked example's advisor message", () => {
    const candidates = paymentStatusExtractor.extract([
      message({ direction: "OUTBOUND", content: "ok aqui le paso el numero de cuenta para que realice el pago" }),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].value).toBe("AWAITING_PAYMENT");
    expect(candidates[0].evidence[0].excerpt).toContain("numero de cuenta");
  });

  it("detects PAYMENT_CONFIRMED from a customer confirmation, with higher confidence than a request", () => {
    const requestCandidates = paymentStatusExtractor.extract([message({ direction: "OUTBOUND", content: "le paso el numero de cuenta" })]);
    const confirmCandidates = paymentStatusExtractor.extract([message({ direction: "INBOUND", content: "ya pagué, gracias" })]);

    expect(confirmCandidates[0].value).toBe("PAYMENT_CONFIRMED");
    expect(confirmCandidates[0].confidence).toBeGreaterThan(requestCandidates[0].confidence);
  });

  it("ignores an advisor payment-request phrase said by the customer, and vice versa", () => {
    const customerSayingRequestPhrase = paymentStatusExtractor.extract([
      message({ direction: "INBOUND", content: "numero de cuenta por favor" }),
    ]);
    const advisorSayingConfirmPhrase = paymentStatusExtractor.extract([
      message({ direction: "OUTBOUND", content: "ya pagué" }),
    ]);

    expect(customerSayingRequestPhrase).toEqual([]);
    expect(advisorSayingConfirmPhrase).toEqual([]);
  });

  it("returns no candidates for ordinary messages", () => {
    const candidates = paymentStatusExtractor.extract([message({ content: "hola, buenos días" })]);
    expect(candidates).toEqual([]);
  });

  it("matches accented and unaccented keyword variants identically", () => {
    const accented = paymentStatusExtractor.extract([message({ direction: "INBOUND", content: "ya pagué todo" })]);
    const unaccented = paymentStatusExtractor.extract([message({ direction: "INBOUND", content: "ya pague todo" })]);

    expect(accented[0].value).toBe("PAYMENT_CONFIRMED");
    expect(unaccented[0].value).toBe("PAYMENT_CONFIRMED");
  });
});
