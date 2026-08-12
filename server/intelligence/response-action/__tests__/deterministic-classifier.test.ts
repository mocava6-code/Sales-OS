// Pure unit tests — no DB, no AI. Proves the deterministic layer's
// precedence rules against the mission's own worked examples plus the
// safety-conscious cases (declines, off-topic content) that must NOT be
// auto-resolved.

import { describe, expect, it } from "vitest";
import { classifyDeterministically } from "../deterministic-classifier";
import type { ActionClassificationEntry, ConversationActionContext } from "../types";

function entry(overrides: Partial<ActionClassificationEntry> & { id: string; direction: "INBOUND" | "OUTBOUND"; content: string }): ActionClassificationEntry {
  return { occurredAt: new Date("2026-08-01T00:00:00Z"), ...overrides };
}

function context(overrides: Partial<ConversationActionContext> & { recentEntries: ActionClassificationEntry[] }): ConversationActionContext {
  const lastEntry = overrides.recentEntries.at(-1);
  return {
    conversationId: "conv-1",
    leadId: "lead-1",
    observedStatus: lastEntry?.direction === "INBOUND" ? "NEEDS_REPLY" : "WAITING_ON_CUSTOMER",
    lastEntryDirection: lastEntry?.direction ?? "INBOUND",
    lastEntryAt: lastEntry?.occurredAt ?? new Date("2026-08-01T00:00:00Z"),
    structural: { leadNextAction: null, hasOverdueFollowUp: false, hasPendingFollowUp: false },
    ...overrides,
  };
}

describe("classifyDeterministically — mission worked examples", () => {
  it('"Ok gracias" alone -> NO_ACTION_REQUIRED', () => {
    const result = classifyDeterministically(context({ recentEntries: [entry({ id: "e1", direction: "INBOUND", content: "Ok gracias" })] }));
    expect(result.resolved).toBe(true);
    expect(result.result?.actionState).toBe("NO_ACTION_REQUIRED");
    expect(result.result?.reasonCode).toBe("CUSTOMER_CLOSING_ACKNOWLEDGEMENT");
  });

  it('"Perfecto 👍" -> NO_ACTION_REQUIRED', () => {
    const result = classifyDeterministically(context({ recentEntries: [entry({ id: "e1", direction: "INBOUND", content: "Perfecto 👍" })] }));
    expect(result.result?.actionState).toBe("NO_ACTION_REQUIRED");
  });

  it("pure emoji closing (👍🙏) -> NO_ACTION_REQUIRED", () => {
    const result = classifyDeterministically(context({ recentEntries: [entry({ id: "e1", direction: "INBOUND", content: "👍🙏" })] }));
    expect(result.result?.actionState).toBe("NO_ACTION_REQUIRED");
  });

  it('"Gracias, ¿cuánto cuesta el envío?" -> REPLY_REQUIRED, not masked by the "gracias" prefix', () => {
    const result = classifyDeterministically(context({ recentEntries: [entry({ id: "e1", direction: "INBOUND", content: "Gracias, ¿cuánto cuesta el envío?" })] }));
    expect(result.resolved).toBe(true);
    expect(result.result?.actionState).toBe("REPLY_REQUIRED");
    expect(result.result?.reasonCode).toBe("PRICE_REQUEST");
  });

  it('"Lo reviso y mañana te confirmo" -> WAITING_ON_CUSTOMER (self-deferral)', () => {
    const result = classifyDeterministically(context({ recentEntries: [entry({ id: "e1", direction: "INBOUND", content: "Lo reviso y mañana te confirmo" })] }));
    expect(result.resolved).toBe(true);
    expect(result.result?.actionState).toBe("WAITING_ON_CUSTOMER");
    expect(result.result?.reasonCode).toBe("CUSTOMER_SELF_DEFERRED");
  });

  it('"Pásame la cuenta para pagar" -> REPLY_REQUIRED / PAYMENT_REQUEST', () => {
    const result = classifyDeterministically(context({ recentEntries: [entry({ id: "e1", direction: "INBOUND", content: "Pásame la cuenta para pagar" })] }));
    expect(result.resolved).toBe(true);
    expect(result.result?.actionState).toBe("REPLY_REQUIRED");
    expect(result.result?.reasonCode).toBe("PAYMENT_REQUEST");
  });

  it('advisor "En 10 minutos te envío la cotización." then customer "Ok gracias" -> FOLLOW_UP_REQUIRED, NOT NO_ACTION_REQUIRED', () => {
    const result = classifyDeterministically(
      context({
        recentEntries: [
          entry({ id: "e1", direction: "OUTBOUND", content: "En 10 minutos te envío la cotización." }),
          entry({ id: "e2", direction: "INBOUND", content: "Ok gracias" }),
        ],
      }),
    );
    expect(result.resolved).toBe(true);
    expect(result.result?.actionState).toBe("FOLLOW_UP_REQUIRED");
    expect(result.result?.reasonCode).toBe("ADVISOR_COMMITMENT_PENDING");
    // The commitment came from the ADVISOR's message, not the customer's closing one.
    expect(result.result?.evidenceEntryIds).toEqual(["e1"]);
  });

  it("the advisor's promise is considered fulfilled once a LATER outbound message exists", () => {
    const result = classifyDeterministically(
      context({
        recentEntries: [
          entry({ id: "e1", direction: "OUTBOUND", content: "En 10 minutos te envío la cotización." }),
          entry({ id: "e2", direction: "INBOUND", content: "Ok gracias" }),
          entry({ id: "e3", direction: "OUTBOUND", content: "Aquí tienes: Hilux TRAVO kit S/500." }),
        ],
      }),
    );
    // e3 has no commitment language and no later outbound after it — falls to WAITING_ON_CUSTOMER.
    expect(result.result?.actionState).toBe("WAITING_ON_CUSTOMER");
  });
});

describe("classifyDeterministically — structural precedence", () => {
  it("an overdue FollowUp always wins, even over a plain closing message", () => {
    const result = classifyDeterministically(
      context({
        recentEntries: [entry({ id: "e1", direction: "INBOUND", content: "Ok gracias" })],
        structural: { leadNextAction: null, hasOverdueFollowUp: true, hasPendingFollowUp: true },
      }),
    );
    expect(result.result?.actionState).toBe("FOLLOW_UP_REQUIRED");
    expect(result.result?.reasonCode).toBe("FOLLOW_UP_DUE");
  });

  it("leadNextAction=CONFIRM_PAYMENT wins over a plain closing message", () => {
    const result = classifyDeterministically(
      context({
        recentEntries: [entry({ id: "e1", direction: "INBOUND", content: "Perfecto" })],
        structural: { leadNextAction: "CONFIRM_PAYMENT", hasOverdueFollowUp: false, hasPendingFollowUp: false },
      }),
    );
    expect(result.result?.actionState).toBe("FOLLOW_UP_REQUIRED");
    expect(result.result?.reasonCode).toBe("PAYMENT_CONFIRMATION_PENDING");
  });

  it("leadNextAction=SCHEDULE_DELIVERY wins over a plain closing message", () => {
    const result = classifyDeterministically(
      context({
        recentEntries: [entry({ id: "e1", direction: "INBOUND", content: "Gracias" })],
        structural: { leadNextAction: "SCHEDULE_DELIVERY", hasOverdueFollowUp: false, hasPendingFollowUp: false },
      }),
    );
    expect(result.result?.actionState).toBe("FOLLOW_UP_REQUIRED");
    expect(result.result?.reasonCode).toBe("DELIVERY_CONFIRMATION_PENDING");
  });
});

describe("classifyDeterministically — advisor just replied", () => {
  it("advisor's last message with no commitment language -> WAITING_ON_CUSTOMER", () => {
    const result = classifyDeterministically(context({ recentEntries: [entry({ id: "e1", direction: "OUTBOUND", content: "Sí, tenemos el kit disponible." })] }));
    expect(result.result?.actionState).toBe("WAITING_ON_CUSTOMER");
    expect(result.result?.reasonCode).toBe("WAITING_FOR_CUSTOMER_DECISION");
  });
});

describe("classifyDeterministically — request signal variety", () => {
  it("compatibility question -> REPLY_REQUIRED / COMPATIBILITY_QUESTION", () => {
    const result = classifyDeterministically(context({ recentEntries: [entry({ id: "e1", direction: "INBOUND", content: "¿Es compatible con mi Hilux 2020?" })] }));
    expect(result.result?.actionState).toBe("REPLY_REQUIRED");
    expect(result.result?.reasonCode).toBe("COMPATIBILITY_QUESTION");
  });

  it("a generic question mark not matching any specific keyword still resolves to REPLY_REQUIRED / CUSTOMER_QUESTION", () => {
    const result = classifyDeterministically(context({ recentEntries: [entry({ id: "e1", direction: "INBOUND", content: "¿Y el color negro?" })] }));
    expect(result.result?.actionState).toBe("REPLY_REQUIRED");
    expect(result.result?.reasonCode).toBe("CUSTOMER_QUESTION");
  });
});

describe("classifyDeterministically — safety: never confidently resolves the risky cases", () => {
  it('an explicit decline ("lo lamento pero no quiero") is left inconclusive, never auto-NO_ACTION_REQUIRED', () => {
    const result = classifyDeterministically(context({ recentEntries: [entry({ id: "e1", direction: "INBOUND", content: "lo lamento pero no quiero" })] }));
    expect(result.resolved).toBe(false);
  });

  it("off-topic personal content unrelated to any commercial pattern is left inconclusive", () => {
    const result = classifyDeterministically(context({ recentEntries: [entry({ id: "e1", direction: "INBOUND", content: "Que te llevo" })] }));
    expect(result.resolved).toBe(false);
  });

  it("an empty recentEntries array is inconclusive, never a default state", () => {
    const result = classifyDeterministically(context({ recentEntries: [] }));
    expect(result.resolved).toBe(false);
  });
});
