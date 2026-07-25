import { describe, expect, it } from "vitest";
import { createRequestedDeliveryAtExtractor } from "../extractors/relative-date-extractor";
import type { NormalizedMessageForExtraction } from "../types";

const LIMA = "America/Lima";

function message(overrides: Partial<NormalizedMessageForExtraction> = {}): NormalizedMessageForExtraction {
  return {
    id: "entry-1",
    conversationId: "conv-1",
    direction: "INBOUND",
    content: "",
    occurredAt: new Date("2026-07-24T15:10:00Z"), // 2026-07-24 10:10 in Lima (Friday)
    ...overrides,
  };
}

describe("requestedDeliveryAt extractor — worked example", () => {
  it("resolves 'para manana a las 12' to tomorrow noon in the business timezone, converted to UTC", () => {
    const extractor = createRequestedDeliveryAtExtractor(LIMA);
    const [candidate] = extractor.extract([message({ content: "para manana a las 12" })]);

    // Message anchor: 2026-07-24 10:10 Lima -> "manana" = 2026-07-25, "a las 12" = noon.
    // Noon in Lima (fixed UTC-5) = 17:00 UTC.
    expect(candidate.value.toISOString()).toBe("2026-07-25T17:00:00.000Z");
    expect(candidate.reasoning).toContain(LIMA);
  });
});

describe("requestedDeliveryAt extractor — general behavior", () => {
  it("returns no candidate when neither a day nor a time expression is present", () => {
    const extractor = createRequestedDeliveryAtExtractor(LIMA);
    expect(extractor.extract([message({ content: "hola, todo bien?" })])).toEqual([]);
  });

  it("resolves 'hoy a las 3' to today at 15:00 local (ambiguous 1-6 defaults to PM)", () => {
    const extractor = createRequestedDeliveryAtExtractor(LIMA);
    const [candidate] = extractor.extract([message({ content: "hoy a las 3" })]);

    expect(candidate.value.toISOString()).toBe("2026-07-24T20:00:00.000Z"); // 15:00 Lima = 20:00 UTC
  });

  it("resolves 'a las 9 de la manana' with an explicit AM qualifier, defaulting the day to today", () => {
    const extractor = createRequestedDeliveryAtExtractor(LIMA);
    const [candidate] = extractor.extract([message({ content: "a las 9 de la manana" })]);

    expect(candidate.value.toISOString()).toBe("2026-07-24T14:00:00.000Z"); // 09:00 Lima = 14:00 UTC
  });

  it("resolves 'pasado manana' to two days after the message's own date", () => {
    const extractor = createRequestedDeliveryAtExtractor(LIMA);
    const [candidate] = extractor.extract([message({ content: "pasado manana a las 12" })]);

    expect(candidate.value.toISOString()).toBe("2026-07-26T17:00:00.000Z");
  });

  it("resolves a weekday name to its next future occurrence, not today even if today matches", () => {
    const extractor = createRequestedDeliveryAtExtractor(LIMA);
    // Anchor (2026-07-24) is a Friday.
    const [nextMonday] = extractor.extract([message({ content: "el lunes a las 12" })]);
    expect(nextMonday.value.toISOString()).toBe("2026-07-27T17:00:00.000Z"); // Monday 2026-07-27

    const [nextFridayWhenTodayIsFriday] = extractor.extract([message({ content: "el viernes a las 12" })]);
    expect(nextFridayWhenTodayIsFriday.value.toISOString()).toBe("2026-07-31T17:00:00.000Z"); // next Friday, +7 days, not today
  });

  it("tags every candidate with its message's evidence and a documented confidence tier", () => {
    const extractor = createRequestedDeliveryAtExtractor(LIMA);
    const [candidate] = extractor.extract([message({ content: "manana a las 12", id: "entry-42" })]);

    expect(candidate.evidence[0].sourceId).toBe("entry-42");
    expect(candidate.confidence).toBeGreaterThan(0);
    expect(candidate.confidence).toBeLessThan(1);
  });
});
