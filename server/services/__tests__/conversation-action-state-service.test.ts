// Pure unit tests (no DB) for the canonical resolver and the raw->context
// transform. classifyConversationAction (deterministic+AI orchestration)
// is exercised via its own component tests
// (server/intelligence/response-action/__tests__/); this file is about
// resolveOperationalActionState's precedence rules specifically.

import { describe, expect, it } from "vitest";
import { resolveOperationalActionState, toConversationActionContext, type StoredActionStateForResolution } from "../conversation-action-state-service";
import type { ConversationActionContext } from "@/server/intelligence/response-action/types";

function liveContext(overrides: Partial<ConversationActionContext> = {}): ConversationActionContext {
  return {
    conversationId: "conv-1",
    leadId: "lead-1",
    observedStatus: "NEEDS_REPLY",
    lastEntryDirection: "INBOUND",
    lastEntryAt: new Date("2026-08-01T00:00:00Z"),
    recentEntries: [{ id: "e1", direction: "INBOUND", content: "¿Cuánto cuesta?", occurredAt: new Date("2026-08-01T00:00:00Z") }],
    structural: { leadNextAction: null, hasOverdueFollowUp: false, hasPendingFollowUp: false },
    ...overrides,
  };
}

function stored(overrides: Partial<StoredActionStateForResolution> = {}): StoredActionStateForResolution {
  return {
    actionState: "NO_ACTION_REQUIRED",
    reasonCode: "CUSTOMER_CLOSING_ACKNOWLEDGEMENT",
    confidence: 0.9,
    reasoning: "stored reasoning",
    evidenceEntryIds: [],
    recommendedAction: null,
    source: "DETERMINISTIC",
    humanOverride: false,
    basedOnLastEntryAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

describe("resolveOperationalActionState", () => {
  it("uses a fresh stored (non-human) state as-is", () => {
    const result = resolveOperationalActionState(new Date("2026-08-01T00:00:00Z"), stored(), liveContext());
    expect(result.actionState).toBe("NO_ACTION_REQUIRED");
    expect(result.source).toBe("DETERMINISTIC");
  });

  it("a fresh human override wins even though live deterministic rules would say otherwise", () => {
    const humanStored = stored({ actionState: "FOLLOW_UP_REQUIRED", reasonCode: "MARKED_FOLLOW_UP_REQUIRED", source: "HUMAN", humanOverride: true });
    const result = resolveOperationalActionState(new Date("2026-08-01T00:00:00Z"), humanStored, liveContext());
    expect(result.actionState).toBe("FOLLOW_UP_REQUIRED");
    expect(result.source).toBe("HUMAN");
  });

  it("a STALE stored state (conversation has new activity since) is ignored — falls through to live recompute", () => {
    const staleStored = stored({ basedOnLastEntryAt: new Date("2026-07-01T00:00:00Z") }); // older than the conversation's current lastEntryAt
    const conversationLastEntryAt = new Date("2026-08-01T00:00:00Z");
    const result = resolveOperationalActionState(conversationLastEntryAt, staleStored, liveContext());
    // live deterministic rules resolve "¿Cuánto cuesta?" to REPLY_REQUIRED, not the stale stored NO_ACTION_REQUIRED.
    expect(result.actionState).toBe("REPLY_REQUIRED");
  });

  it("a STALE human override is also ignored — a new message makes even a human decision stale", () => {
    const staleHuman = stored({ actionState: "NO_ACTION_REQUIRED", source: "HUMAN", humanOverride: true, basedOnLastEntryAt: new Date("2026-07-01T00:00:00Z") });
    const conversationLastEntryAt = new Date("2026-08-01T00:00:00Z");
    const result = resolveOperationalActionState(conversationLastEntryAt, staleHuman, liveContext());
    expect(result.actionState).toBe("REPLY_REQUIRED");
    expect(result.source).not.toBe("HUMAN");
  });

  it("no stored state at all -> falls through to live deterministic recompute", () => {
    const result = resolveOperationalActionState(new Date("2026-08-01T00:00:00Z"), null, liveContext());
    expect(result.actionState).toBe("REPLY_REQUIRED");
  });

  it("no stored state AND live deterministic rules are inconclusive -> UNCERTAIN, never a guessed default", () => {
    const ambiguous = liveContext({ recentEntries: [{ id: "e1", direction: "INBOUND", content: "Que te llevo", occurredAt: new Date() }] });
    const result = resolveOperationalActionState(new Date("2026-08-01T00:00:00Z"), null, ambiguous);
    expect(result.actionState).toBe("UNCERTAIN");
  });
});

describe("toConversationActionContext", () => {
  it("computes hasOverdueFollowUp/hasPendingFollowUp from PENDING follow-ups only, ignoring DONE/SNOOZED", () => {
    const context = toConversationActionContext({
      id: "conv-1",
      leadId: "lead-1",
      status: "NEEDS_REPLY",
      lastEntryAt: new Date(),
      lastEntryDirection: "INBOUND",
      entries: [],
      lead: {
        commercialProfile: null,
        followUps: [
          { status: "DONE", dueAt: new Date("2000-01-01") },
          { status: "PENDING", dueAt: new Date("2099-01-01") }, // pending but not yet due
        ],
      },
    });
    expect(context.structural.hasPendingFollowUp).toBe(true);
    expect(context.structural.hasOverdueFollowUp).toBe(false);
  });

  it("hasOverdueFollowUp is true only when a PENDING follow-up's dueAt is in the past", () => {
    const context = toConversationActionContext({
      id: "conv-1",
      leadId: "lead-1",
      status: "NEEDS_REPLY",
      lastEntryAt: new Date(),
      lastEntryDirection: "INBOUND",
      entries: [],
      lead: { commercialProfile: null, followUps: [{ status: "PENDING", dueAt: new Date("2000-01-01") }] },
    });
    expect(context.structural.hasOverdueFollowUp).toBe(true);
  });

  it("carries leadNextAction through from the commercial profile, null when no profile exists", () => {
    const withProfile = toConversationActionContext({
      id: "conv-1",
      leadId: "lead-1",
      status: "NEEDS_REPLY",
      lastEntryAt: new Date(),
      lastEntryDirection: "INBOUND",
      entries: [],
      lead: { commercialProfile: { nextAction: "CONFIRM_PAYMENT" }, followUps: [] },
    });
    expect(withProfile.structural.leadNextAction).toBe("CONFIRM_PAYMENT");

    const withoutProfile = toConversationActionContext({
      id: "conv-1",
      leadId: "lead-1",
      status: "NEEDS_REPLY",
      lastEntryAt: new Date(),
      lastEntryDirection: "INBOUND",
      entries: [],
      lead: { commercialProfile: null, followUps: [] },
    });
    expect(withoutProfile.structural.leadNextAction).toBeNull();
  });
});
