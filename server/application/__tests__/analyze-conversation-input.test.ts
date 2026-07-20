import { describe, expect, it } from "vitest";
import { buildEngineInputFromConversation } from "../analyze-conversation-input";

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
