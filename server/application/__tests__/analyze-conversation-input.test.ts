import { describe, expect, it } from "vitest";
import { buildEngineInputFromConversation, MAX_ENGINE_INPUT_TRANSCRIPT_CHARS } from "../analyze-conversation-input";

describe("buildEngineInputFromConversation — 10. loads messages in chronological order", () => {
  it("sorts scrambled entries by occurredAt regardless of input order", () => {
    const conversation = {
      channel: "WHATSAPP" as const,
      entries: [
        { direction: "OUTBOUND" as const, content: "third", occurredAt: new Date("2026-07-18T14:00:00.000Z") },
        { direction: "INBOUND" as const, content: "first", occurredAt: new Date("2026-07-18T12:00:00.000Z") },
        { direction: "INBOUND" as const, content: "second", occurredAt: new Date("2026-07-18T13:00:00.000Z") },
      ],
    };

    const input = buildEngineInputFromConversation("biz-1", conversation);

    expect(input.messages?.map((m) => m.content)).toEqual(["first", "second", "third"]);
  });

  it("maps WHATSAPP to the whatsapp channel and preserves direction/content", () => {
    const conversation = {
      channel: "WHATSAPP" as const,
      entries: [{ direction: "INBOUND" as const, content: "Hola", occurredAt: new Date("2026-07-18T12:00:00.000Z") }],
    };

    const input = buildEngineInputFromConversation("biz-1", conversation);

    expect(input.tenantId).toBe("biz-1");
    expect(input.channel).toBe("whatsapp");
    expect(input.messages).toEqual([{ direction: "INBOUND", content: "Hola", occurredAt: conversation.entries[0].occurredAt }]);
  });

  it.each(["CALL", "IN_PERSON", "OTHER"] as const)("maps CRM channel %s to the manual engine channel", (channel) => {
    const input = buildEngineInputFromConversation("biz-1", { channel, entries: [] });
    expect(input.channel).toBe("manual");
  });

  it("returns an empty messages array for a conversation with no entries", () => {
    const input = buildEngineInputFromConversation("biz-1", { channel: "WHATSAPP", entries: [] });
    expect(input.messages).toEqual([]);
  });
});

describe("buildEngineInputFromConversation — Part 7 bounded-context window (fixes quadratic full-history resend)", () => {
  function longMessage(n: number, size = 200): { direction: "INBOUND" | "OUTBOUND"; content: string; occurredAt: Date } {
    return {
      direction: n % 2 === 0 ? "INBOUND" : "OUTBOUND",
      content: `msg-${n}-`.padEnd(size, "x"),
      occurredAt: new Date(2026, 6, 1, 0, 0, n), // strictly increasing, one second apart
    };
  }

  it("does not truncate a conversation that fits comfortably under the budget — the common case is unaffected", () => {
    const entries = Array.from({ length: 10 }, (_, i) => longMessage(i, 50));
    const input = buildEngineInputFromConversation("biz-1", { channel: "WHATSAPP", entries });

    expect(input.messages).toHaveLength(10);
  });

  it("bounds a long conversation to the most recent messages, dropping the oldest first", () => {
    // Each message ~200 chars; budget is 12_000 -> comfortably fewer than 200 messages survive.
    const entries = Array.from({ length: 200 }, (_, i) => longMessage(i, 200));
    const input = buildEngineInputFromConversation("biz-1", { channel: "WHATSAPP", entries });

    expect(input.messages!.length).toBeLessThan(200);
    expect(input.messages!.length).toBeGreaterThan(0);
    // The LAST message in the window must be the conversation's actual latest message.
    expect(input.messages![input.messages!.length - 1].content).toContain("msg-199-");
    // The FIRST message in the window must NOT be the conversation's actual oldest message — it was dropped.
    expect(input.messages![0].content).not.toContain("msg-0-");
  });

  it("preserves chronological order within the bounded window", () => {
    const entries = Array.from({ length: 200 }, (_, i) => longMessage(i, 200));
    const input = buildEngineInputFromConversation("biz-1", { channel: "WHATSAPP", entries });

    const timestamps = input.messages!.map((m) => m.occurredAt.getTime());
    const sorted = [...timestamps].sort((a, b) => a - b);
    expect(timestamps).toEqual(sorted);
  });

  it("never drops below 1 message, even when a single message alone exceeds the budget", () => {
    const entries = [longMessage(0, MAX_ENGINE_INPUT_TRANSCRIPT_CHARS + 5_000)];
    const input = buildEngineInputFromConversation("biz-1", { channel: "WHATSAPP", entries });

    expect(input.messages).toHaveLength(1);
  });

  it("keeps the total content length of the window at or under the budget whenever more than one message survives", () => {
    const entries = Array.from({ length: 200 }, (_, i) => longMessage(i, 200));
    const input = buildEngineInputFromConversation("biz-1", { channel: "WHATSAPP", entries });

    const totalChars = input.messages!.reduce((sum, m) => sum + m.content.length, 0);
    expect(totalChars).toBeLessThanOrEqual(MAX_ENGINE_INPUT_TRANSCRIPT_CHARS);
  });
});
