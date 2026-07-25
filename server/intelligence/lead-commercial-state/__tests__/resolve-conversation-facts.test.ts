import { describe, expect, it } from "vitest";
import { resolveConversationFacts } from "../resolve-conversation-facts";
import type { ActiveConversationContext } from "../types";

describe("resolveConversationFacts", () => {
  it("reads lastContactAt/lastContactDirection/conversationState directly from the active conversation context", () => {
    const context: ActiveConversationContext = {
      activeConversationId: "conv-1",
      conversationState: "WAITING_ON_CUSTOMER",
      lastContactAt: new Date("2026-07-24T15:00:00Z"),
      lastContactDirection: "OUTBOUND",
    };

    const facts = resolveConversationFacts(context);

    expect(facts.lastContactAt).toEqual({
      kind: "fact",
      value: new Date("2026-07-24T15:00:00Z"),
      confidence: 1,
      evidence: [{ sourceType: "conversation_message", sourceId: "conv-1" }],
    });
    expect(facts.lastContactDirection.value).toBe("OUTBOUND");
    expect(facts.conversationState.value).toBe("WAITING_ON_CUSTOMER");
  });

  it("every fact carries confidence 1 and evidence pointing at the active conversation", () => {
    const context: ActiveConversationContext = {
      activeConversationId: "conv-2",
      conversationState: "NEEDS_REPLY",
      lastContactAt: new Date("2026-07-20T09:00:00Z"),
      lastContactDirection: "INBOUND",
    };

    const facts = resolveConversationFacts(context);

    for (const fact of Object.values(facts)) {
      expect(fact.confidence).toBe(1);
      expect(fact.evidence[0].sourceId).toBe("conv-2");
    }
  });
});
