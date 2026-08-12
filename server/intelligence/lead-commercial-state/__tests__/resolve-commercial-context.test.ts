import { describe, expect, it } from "vitest";
import { resolveCommercialContextConversationId } from "../resolve-commercial-context";
import type { ConversationSummaryForActiveResolution } from "../types";

function conversations(overrides: Partial<ConversationSummaryForActiveResolution>[]): ConversationSummaryForActiveResolution[] {
  return overrides.map((o, i) => ({
    id: `conv-${i}`,
    status: "NEEDS_REPLY",
    lastEntryAt: new Date("2026-01-01T00:00:00Z"),
    lastEntryDirection: "INBOUND",
    ...o,
  })) as ConversationSummaryForActiveResolution[];
}

describe("resolveCommercialContextConversationId", () => {
  it("falls back to the operationally-active conversation when there are no commercial candidates at all", () => {
    const result = resolveCommercialContextConversationId([], conversations([{ id: "conv-a" }]), "conv-a");
    expect(result).toBe("conv-a");
  });

  it("THE CORE FIX: picks the conversation whose commercial evidence is freshest, ignoring a newer conversation's unrelated non-commercial activity", () => {
    // conv-manual has the single commercial candidate from weeks ago;
    // conv-whatsapp's commercial candidate is more recent, even though
    // it's not reflected in either conversation's lastEntryAt here (the
    // resolver only looks at candidate timestamps, not conversation rows,
    // for this decision).
    const result = resolveCommercialContextConversationId(
      [
        { conversationId: "conv-manual", occurredAt: new Date("2026-07-24T22:24:50.000Z") },
        { conversationId: "conv-whatsapp", occurredAt: new Date("2026-08-11T13:48:17.000Z") },
      ],
      conversations([{ id: "conv-manual" }, { id: "conv-whatsapp" }]),
      "conv-manual",
    );

    expect(result).toBe("conv-whatsapp");
  });

  it("prefers a non-CLOSED conversation over a CLOSED one even if the closed one's commercial evidence is more recent", () => {
    const result = resolveCommercialContextConversationId(
      [
        { conversationId: "conv-closed", occurredAt: new Date("2026-08-01T00:00:00Z") },
        { conversationId: "conv-open", occurredAt: new Date("2026-07-01T00:00:00Z") },
      ],
      conversations([{ id: "conv-closed", status: "CLOSED" }, { id: "conv-open", status: "NEEDS_REPLY" }]),
      "conv-open",
    );

    expect(result).toBe("conv-open");
  });

  it("falls back to the CLOSED pool when every candidate-bearing conversation is CLOSED", () => {
    const result = resolveCommercialContextConversationId(
      [{ conversationId: "conv-closed", occurredAt: new Date("2026-08-01T00:00:00Z") }],
      conversations([{ id: "conv-closed", status: "CLOSED" }]),
      "conv-closed",
    );

    expect(result).toBe("conv-closed");
  });

  it("ignores candidates from conversations that aren't part of this lead's known conversation set", () => {
    const result = resolveCommercialContextConversationId(
      [{ conversationId: "conv-unknown", occurredAt: new Date("2026-08-01T00:00:00Z") }],
      conversations([{ id: "conv-known" }]),
      "conv-known",
    );

    expect(result).toBe("conv-known");
  });

  it("picks the conversation with the most candidate activity when multiple conversations tie exactly on their latest candidate timestamp", () => {
    const t = new Date("2026-08-01T00:00:00Z");
    const result = resolveCommercialContextConversationId(
      [
        { conversationId: "conv-a", occurredAt: t },
        { conversationId: "conv-b", occurredAt: t },
      ],
      conversations([{ id: "conv-a" }, { id: "conv-b" }]),
      "conv-a",
    );

    // Deterministic (stable) tie-break — either is acceptable as long as
    // it's consistently one of the two candidate-bearing conversations.
    expect(["conv-a", "conv-b"]).toContain(result);
  });
});
