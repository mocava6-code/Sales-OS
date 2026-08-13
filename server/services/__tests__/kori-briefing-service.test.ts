import { describe, expect, it } from "vitest";
import type { TodayActionGroupEntry } from "../conversation-action-state-service";
import { buildPulseSummary, countStaleReplies, deriveOpportunities, type KoriBriefing } from "../kori-briefing-service";

function entry(overrides: Partial<TodayActionGroupEntry> = {}): TodayActionGroupEntry {
  return {
    leadId: "lead-1",
    leadName: "Juan Pérez",
    leadPhone: "+51933517901",
    conversationId: "conv-1",
    actionState: "REPLY_REQUIRED",
    reasonCode: "CUSTOMER_QUESTION",
    recommendedAction: null,
    lastActivityAt: new Date("2026-08-10T10:00:00.000Z"),
    vehicleBrand: null,
    vehicleModel: null,
    productInterest: null,
    assignedAdvisorName: null,
    ...overrides,
  };
}

describe("deriveOpportunities", () => {
  it("keeps only buying-signal and stalled-commitment reason codes, dropping everything else", () => {
    const entries = [
      entry({ leadId: "l1", reasonCode: "BUYING_SIGNAL" }),
      entry({ leadId: "l2", reasonCode: "CUSTOMER_QUESTION" }),
      entry({ leadId: "l3", reasonCode: "ADVISOR_COMMITMENT_PENDING" }),
      entry({ leadId: "l4", reasonCode: "PRICE_REQUEST" }),
    ];

    const result = deriveOpportunities(entries);

    expect(result.map((o) => o.leadId)).toEqual(["l1", "l3"]);
  });

  it("ranks buying signals ahead of stalled commitments regardless of waiting time", () => {
    const entries = [
      entry({ leadId: "recent-commitment", reasonCode: "QUOTATION_PROMISED", lastActivityAt: new Date("2026-08-12T09:00:00.000Z") }),
      entry({ leadId: "old-buying-signal", reasonCode: "DISCOUNT_REQUEST", lastActivityAt: new Date("2026-08-12T08:00:00.000Z") }),
    ];

    const result = deriveOpportunities(entries);

    expect(result[0].leadId).toBe("old-buying-signal");
    expect(result[0].kind).toBe("buying_signal");
    expect(result[1].kind).toBe("stalled_commitment");
  });

  it("within the same tier, ranks the longest-waiting lead first", () => {
    const entries = [
      entry({ leadId: "waited-1h", reasonCode: "BUYING_SIGNAL", lastActivityAt: new Date("2026-08-12T11:00:00.000Z") }),
      entry({ leadId: "waited-6h", reasonCode: "BUYING_SIGNAL", lastActivityAt: new Date("2026-08-12T06:00:00.000Z") }),
    ];

    const result = deriveOpportunities(entries);

    expect(result.map((o) => o.leadId)).toEqual(["waited-6h", "waited-1h"]);
  });

  it("caps the result at 5 opportunities even with more candidates available", () => {
    const entries = Array.from({ length: 8 }, (_, i) => entry({ leadId: `lead-${i}`, reasonCode: "BUYING_SIGNAL" }));

    expect(deriveOpportunities(entries)).toHaveLength(5);
  });

  it("builds vehicleLine from brand+model when present, falling back to productInterest", () => {
    const withVehicle = entry({ reasonCode: "BUYING_SIGNAL", vehicleBrand: "Toyota", vehicleModel: "Hilux" });
    const withProductOnly = entry({ leadId: "l2", reasonCode: "BUYING_SIGNAL", productInterest: "Kit TRAVO" });
    const withNeither = entry({ leadId: "l3", reasonCode: "BUYING_SIGNAL" });

    const result = deriveOpportunities([withVehicle, withProductOnly, withNeither]);

    expect(result.find((o) => o.leadId === "lead-1")?.vehicleLine).toBe("Toyota Hilux");
    expect(result.find((o) => o.leadId === "l2")?.vehicleLine).toBe("Kit TRAVO");
    expect(result.find((o) => o.leadId === "l3")?.vehicleLine).toBeNull();
  });
});

describe("countStaleReplies", () => {
  const now = new Date("2026-08-12T12:00:00.000Z");

  it("counts entries waiting 48 hours or more", () => {
    const entries = [
      entry({ lastActivityAt: new Date("2026-08-10T11:00:00.000Z") }), // 49h — stale
      entry({ lastActivityAt: new Date("2026-08-11T13:00:00.000Z") }), // 23h — not stale
      entry({ lastActivityAt: new Date("2026-08-10T12:00:00.000Z") }), // exactly 48h — stale
    ];

    expect(countStaleReplies(entries, now)).toBe(2);
  });

  it("never counts a lead with no conversation (lastActivityAt null)", () => {
    expect(countStaleReplies([entry({ lastActivityAt: null })], now)).toBe(0);
  });

  it("returns 0 for an empty list", () => {
    expect(countStaleReplies([], now)).toBe(0);
  });
});

describe("buildPulseSummary", () => {
  function briefing(overrides: Partial<Pick<KoriBriefing, "stats" | "alerts" | "demandSignals">> = {}) {
    return {
      stats: { replyRequiredCount: 0, overdueFollowUpCount: 0, newLeadsThisWeek: 0, pendingDecisionsCount: 0 },
      alerts: { staleReplyCount: 0, unassignedHighPriorityCount: 0 },
      demandSignals: [],
      ...overrides,
    };
  }

  it("reports a calm state when nobody needs a reply", () => {
    expect(buildPulseSummary(briefing())).toBe("Nadie requiere respuesta en este momento.");
  });

  it("uses singular grammar for exactly one pending reply", () => {
    const summary = buildPulseSummary(briefing({ stats: { replyRequiredCount: 1, overdueFollowUpCount: 0, newLeadsThisWeek: 0, pendingDecisionsCount: 0 } }));
    expect(summary).toBe("1 cliente requiere respuesta ahora.");
  });

  it("uses plural grammar and names the stale count when there is one", () => {
    const summary = buildPulseSummary(
      briefing({
        stats: { replyRequiredCount: 14, overdueFollowUpCount: 0, newLeadsThisWeek: 0, pendingDecisionsCount: 0 },
        alerts: { staleReplyCount: 3, unassignedHighPriorityCount: 0 },
      }),
    );
    expect(summary).toBe("14 clientes requieren respuesta ahora — 3 llevan más de 48 horas esperando.");
  });

  it("appends the top demand signal when one exists", () => {
    const summary = buildPulseSummary(briefing({ demandSignals: [{ label: "Toyota Hilux", count: 18, percentage: 41 }] }));
    expect(summary).toContain("El interés en Toyota Hilux sigue liderando esta semana.");
  });

  it("never mentions a raw reasonCode or internal enum value", () => {
    const summary = buildPulseSummary(
      briefing({ stats: { replyRequiredCount: 5, overdueFollowUpCount: 0, newLeadsThisWeek: 0, pendingDecisionsCount: 0 } }),
    );
    expect(summary).not.toMatch(/[A-Z_]{4,}/);
  });
});
