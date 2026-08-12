import { describe, expect, it } from "vitest";
import { foldMutableFieldCandidates, foldTransientFieldCandidates } from "../fold-candidates";
import type { FieldCandidate } from "../types";

function candidate(overrides: Partial<FieldCandidate<string>> = {}): FieldCandidate<string> {
  return {
    value: "value",
    confidence: 0.5,
    conversationId: "conv-active",
    occurredAt: new Date("2026-07-24T12:00:00Z"),
    evidence: [{ sourceType: "conversation_message", sourceId: "entry-1" }],
    ...overrides,
  };
}

describe("foldMutableFieldCandidates", () => {
  it("returns null when there are no candidates at all", () => {
    expect(foldMutableFieldCandidates([], "conv-active")).toBeNull();
  });

  it("THE CORE FIX: an older high-confidence historical candidate never permanently freezes the field — a new active-conversation candidate wins even at equal confidence", () => {
    const historicalFortuner = candidate({
      value: "Fortuner",
      confidence: 0.9,
      conversationId: "conv-old-closed",
      occurredAt: new Date("2026-06-01T12:00:00Z"),
    });
    const activeHilux = candidate({
      value: "Hilux TRAVO 2026",
      confidence: 0.6, // even a LOWER confidence than the stale historical one
      conversationId: "conv-active",
      occurredAt: new Date("2026-07-24T12:00:00Z"),
    });

    const result = foldMutableFieldCandidates([historicalFortuner, activeHilux], "conv-active");

    expect(result?.value).toBe("Hilux TRAVO 2026");
  });

  it("within the active conversation's own candidates, confidence still wins over recency", () => {
    const olderButMoreExplicit = candidate({
      value: "Hilux TRAVO 2026 kit",
      confidence: 0.9,
      conversationId: "conv-active",
      occurredAt: new Date("2026-07-24T09:00:00Z"),
    });
    const newerButVaguer = candidate({
      value: "algo",
      confidence: 0.3,
      conversationId: "conv-active",
      occurredAt: new Date("2026-07-24T15:00:00Z"),
    });

    const result = foldMutableFieldCandidates([olderButMoreExplicit, newerButVaguer], "conv-active");

    expect(result?.value).toBe("Hilux TRAVO 2026 kit");
  });

  it("recency breaks a genuine tie in confidence, within the same conversation", () => {
    const earlier = candidate({ value: "Fortuner", confidence: 0.6, occurredAt: new Date("2026-07-24T09:00:00Z") });
    const later = candidate({ value: "Hilux", confidence: 0.6, occurredAt: new Date("2026-07-24T15:00:00Z") });

    const result = foldMutableFieldCandidates([earlier, later], "conv-active");

    expect(result?.value).toBe("Hilux");
  });

  it("falls back to historical candidates only when the active conversation produced none", () => {
    const historicalOnly = candidate({ value: "Fortuner", conversationId: "conv-old-closed" });

    const result = foldMutableFieldCandidates([historicalOnly], "conv-active");

    expect(result?.value).toBe("Fortuner");
  });

  it("preserves the winning candidate's confidence, evidence, and reasoning verbatim", () => {
    const winner = candidate({
      value: "Chaclacayo",
      confidence: 0.85,
      evidence: [{ sourceType: "conversation_message", sourceId: "entry-9", excerpt: "hace envíos a chaclacayo?" }],
      reasoning: "Matched against a known Peru district/city gazetteer.",
    });

    const result = foldMutableFieldCandidates([winner], "conv-active");

    expect(result).toEqual({
      value: "Chaclacayo",
      confidence: 0.85,
      evidence: [{ sourceType: "conversation_message", sourceId: "entry-9", excerpt: "hace envíos a chaclacayo?" }],
      reasoning: "Matched against a known Peru district/city gazetteer.",
    });
  });
});

describe("foldTransientFieldCandidates", () => {
  it("returns null when there are no candidates at all", () => {
    expect(foldTransientFieldCandidates([], "conv-active")).toBeNull();
  });

  it("THE CONTAMINATION FIX: never falls back to a historical conversation's candidate, even when the current context conversation has none", () => {
    const historicalPaymentRequest = candidate({
      value: "AWAITING_PAYMENT",
      confidence: 0.85,
      conversationId: "conv-old-manual-entry",
      occurredAt: new Date("2026-07-24T22:24:50.945Z"),
    });

    const result = foldTransientFieldCandidates([historicalPaymentRequest], "conv-active");

    expect(result).toBeNull();
  });

  it("resolves normally from the current context conversation's own candidates when present", () => {
    const inContext = candidate({ value: "AWAITING_PAYMENT", conversationId: "conv-active" });
    const historical = candidate({ value: "PAYMENT_CONFIRMED", confidence: 0.95, conversationId: "conv-old" });

    const result = foldTransientFieldCandidates([inContext, historical], "conv-active");

    expect(result?.value).toBe("AWAITING_PAYMENT");
  });

  it("within the current context conversation, confidence then recency still decide ties", () => {
    const lower = candidate({ value: "low", confidence: 0.5, conversationId: "conv-active", occurredAt: new Date("2026-07-24T09:00:00Z") });
    const higher = candidate({ value: "high", confidence: 0.9, conversationId: "conv-active", occurredAt: new Date("2026-07-24T08:00:00Z") });

    const result = foldTransientFieldCandidates([lower, higher], "conv-active");

    expect(result?.value).toBe("high");
  });
});
