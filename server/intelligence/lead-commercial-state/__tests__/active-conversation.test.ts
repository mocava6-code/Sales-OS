import { describe, expect, it } from "vitest";
import { resolveActiveConversation } from "../active-conversation";
import type { ConversationSummaryForActiveResolution } from "../types";

function conversation(overrides: Partial<ConversationSummaryForActiveResolution> = {}): ConversationSummaryForActiveResolution {
  return {
    id: "conv-1",
    status: "WAITING_ON_CUSTOMER",
    lastEntryAt: new Date("2026-07-20T12:00:00Z"),
    lastEntryDirection: "OUTBOUND",
    ...overrides,
  };
}

describe("resolveActiveConversation", () => {
  it("returns null for an empty list", () => {
    expect(resolveActiveConversation([])).toBeNull();
  });

  it("returns the only conversation when there's just one", () => {
    const conv = conversation();
    expect(resolveActiveConversation([conv])).toEqual(conv);
  });

  it("prefers the most recently active NON-CLOSED conversation over a more recent CLOSED one", () => {
    const closedButNewer = conversation({ id: "closed-newer", status: "CLOSED", lastEntryAt: new Date("2026-07-24T12:00:00Z") });
    const openButOlder = conversation({ id: "open-older", status: "WAITING_ON_CUSTOMER", lastEntryAt: new Date("2026-07-20T12:00:00Z") });

    const result = resolveActiveConversation([closedButNewer, openButOlder]);

    expect(result?.id).toBe("open-older");
  });

  it("among multiple non-closed conversations, picks the most recently active one", () => {
    const older = conversation({ id: "conv-older", status: "NEEDS_REPLY", lastEntryAt: new Date("2026-07-18T12:00:00Z") });
    const newer = conversation({ id: "conv-newer", status: "WAITING_ON_CUSTOMER", lastEntryAt: new Date("2026-07-22T12:00:00Z") });

    const result = resolveActiveConversation([older, newer]);

    expect(result?.id).toBe("conv-newer");
  });

  it("falls back to the most recently closed conversation when every conversation is closed", () => {
    const olderClosed = conversation({ id: "closed-older", status: "CLOSED", lastEntryAt: new Date("2026-07-10T12:00:00Z") });
    const newerClosed = conversation({ id: "closed-newer", status: "CLOSED", lastEntryAt: new Date("2026-07-20T12:00:00Z") });

    const result = resolveActiveConversation([olderClosed, newerClosed]);

    expect(result?.id).toBe("closed-newer");
  });
});
