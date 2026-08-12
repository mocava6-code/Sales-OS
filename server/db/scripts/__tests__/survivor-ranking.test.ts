// Pure unit tests (no DB) for Kori Legacy Data Remediation v0's Phase B
// survivor ranking — commercialProfileRichness and recommendSurvivor.
// recommendSurvivor never touches the database; these tests prove its
// 8-step deterministic ordering in isolation, one criterion at a time.

import { describe, expect, it } from "vitest";
import { commercialProfileRichness, recommendSurvivor, type DuplicateLeadPhoneGroupMember } from "../audit-duplicate-lead-phones";

function baseMember(overrides: Partial<DuplicateLeadPhoneGroupMember> & { leadId: string }): DuplicateLeadPhoneGroupMember {
  return {
    name: "+51900000000",
    rawPhone: "+51900000000",
    status: "NEW",
    priority: "NORMAL",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastContactAt: null,
    assignedAgentId: null,
    assignedAgentName: null,
    conversationCount: 0,
    latestConversationLastEntryAt: null,
    latestConversationStatus: null,
    followUpCount: 0,
    openFollowUpCount: 0,
    outcomeCount: 0,
    hasCommercialProfile: false,
    commercialProfile: null,
    ...overrides,
  };
}

describe("commercialProfileRichness", () => {
  it("is 0 for no profile at all", () => {
    expect(commercialProfileRichness(null)).toBe(0);
  });

  it("counts only non-null fields", () => {
    expect(
      commercialProfileRichness({
        vehicleBrand: "Toyota",
        vehicleModel: "Hilux",
        vehicleYear: null,
        productInterest: null,
        customerType: null,
        nextAction: null,
        primaryObjection: null,
      }),
    ).toBe(2);
  });

  it("is 7 when every field is populated", () => {
    expect(
      commercialProfileRichness({
        vehicleBrand: "Toyota",
        vehicleModel: "Hilux",
        vehicleYear: 2022,
        productInterest: "TRAVO kit",
        customerType: "RETAIL",
        nextAction: "SEND_QUOTE",
        primaryObjection: "price",
      }),
    ).toBe(7);
  });
});

describe("recommendSurvivor", () => {
  it("throws on an empty candidate list — a group with zero members should never be constructed", () => {
    expect(() => recommendSurvivor([])).toThrow();
  });

  it("a single-candidate group recommends that candidate with no losers", () => {
    const only = baseMember({ leadId: "lead-1" });
    const result = recommendSurvivor([only]);
    expect(result.recommendedSurvivorLeadId).toBe("lead-1");
    expect(result.loserLeadIds).toEqual([]);
  });

  it("1. prefers a non-placeholder name over a phone-placeholder name — the criterion cannot tell a real customer name from any other non-placeholder string", () => {
    const placeholder = baseMember({ leadId: "lead-placeholder", name: "+51900000000", rawPhone: "+51900000000" });
    const nonPlaceholder = baseMember({ leadId: "lead-non-placeholder", name: "Juan Pérez", rawPhone: "+51900000000" });
    const result = recommendSurvivor([placeholder, nonPlaceholder]);
    expect(result.recommendedSurvivorLeadId).toBe("lead-non-placeholder");
    expect(result.loserLeadIds).toEqual(["lead-placeholder"]);
    expect(result.survivorReasonSummary).toContain("non-placeholder name");
  });

  it("1b. a non-placeholder name that is NOT a real customer name (e.g. a test artifact like \"prueba\") still wins over a placeholder — this criterion makes no identity judgment, confirmed against a real production case", () => {
    const placeholder = baseMember({ leadId: "lead-placeholder", name: "+51900000001", rawPhone: "+51900000001" });
    const testArtifact = baseMember({ leadId: "lead-test-artifact", name: "prueba", rawPhone: "+51900000001" });
    const result = recommendSurvivor([placeholder, testArtifact]);
    expect(result.recommendedSurvivorLeadId).toBe("lead-test-artifact");
  });

  it("2. when names tie, prefers more conversations", () => {
    const few = baseMember({ leadId: "lead-few", name: "Juan Pérez", conversationCount: 1 });
    const many = baseMember({ leadId: "lead-many", name: "Juan Pérez", conversationCount: 5 });
    const result = recommendSurvivor([few, many]);
    expect(result.recommendedSurvivorLeadId).toBe("lead-many");
    expect(result.survivorReasonSummary).toContain("more conversations");
  });

  it("3. when conversations tie, prefers a richer commercial profile", () => {
    const sparse = baseMember({
      leadId: "lead-sparse",
      name: "Juan Pérez",
      conversationCount: 2,
      commercialProfile: { vehicleBrand: "Toyota", vehicleModel: null, vehicleYear: null, productInterest: null, customerType: null, nextAction: null, primaryObjection: null },
    });
    const rich = baseMember({
      leadId: "lead-rich",
      name: "Juan Pérez",
      conversationCount: 2,
      commercialProfile: {
        vehicleBrand: "Toyota",
        vehicleModel: "Hilux",
        vehicleYear: 2022,
        productInterest: "TRAVO kit",
        customerType: "RETAIL",
        nextAction: null,
        primaryObjection: null,
      },
    });
    const result = recommendSurvivor([sparse, rich]);
    expect(result.recommendedSurvivorLeadId).toBe("lead-rich");
    expect(result.survivorReasonSummary).toContain("richer commercial profile");
  });

  it("4. when profile richness ties, prefers more outcomes", () => {
    const fewer = baseMember({ leadId: "lead-fewer-outcomes", name: "Juan Pérez", conversationCount: 2, outcomeCount: 0 });
    const more = baseMember({ leadId: "lead-more-outcomes", name: "Juan Pérez", conversationCount: 2, outcomeCount: 3 });
    const result = recommendSurvivor([fewer, more]);
    expect(result.recommendedSurvivorLeadId).toBe("lead-more-outcomes");
    expect(result.survivorReasonSummary).toContain("more recorded outcomes");
  });

  it("5. when outcomes tie, prefers more follow-ups", () => {
    const fewer = baseMember({ leadId: "lead-fewer-followups", name: "Juan Pérez", conversationCount: 2, followUpCount: 0 });
    const more = baseMember({ leadId: "lead-more-followups", name: "Juan Pérez", conversationCount: 2, followUpCount: 4 });
    const result = recommendSurvivor([fewer, more]);
    expect(result.recommendedSurvivorLeadId).toBe("lead-more-followups");
    expect(result.survivorReasonSummary).toContain("more follow-ups");
  });

  it("6. when follow-ups tie, prefers an assigned lead over an unassigned one", () => {
    const unassigned = baseMember({ leadId: "lead-unassigned", name: "Juan Pérez", conversationCount: 2, assignedAgentId: null });
    const assigned = baseMember({ leadId: "lead-assigned", name: "Juan Pérez", conversationCount: 2, assignedAgentId: "agent-1" });
    const result = recommendSurvivor([unassigned, assigned]);
    expect(result.recommendedSurvivorLeadId).toBe("lead-assigned");
    expect(result.survivorReasonSummary).toContain("assigned to an agent");
  });

  it("7. when assignment ties, prefers the older createdAt", () => {
    const newer = baseMember({ leadId: "lead-newer", name: "Juan Pérez", conversationCount: 2, createdAt: new Date("2026-06-01T00:00:00Z") });
    const older = baseMember({ leadId: "lead-older", name: "Juan Pérez", conversationCount: 2, createdAt: new Date("2026-01-01T00:00:00Z") });
    const result = recommendSurvivor([newer, older]);
    expect(result.recommendedSurvivorLeadId).toBe("lead-older");
    expect(result.survivorReasonSummary).toContain("created earlier");
  });

  it("8. stable final tie-break: when every criterion ties, picks the lexicographically smallest leadId", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const b = baseMember({ leadId: "lead-b", name: "Juan Pérez", conversationCount: 2, createdAt });
    const a = baseMember({ leadId: "lead-a", name: "Juan Pérez", conversationCount: 2, createdAt });
    const result = recommendSurvivor([b, a]);
    expect(result.recommendedSurvivorLeadId).toBe("lead-a");
    expect(result.survivorReasonSummary).toContain("tied with");
    expect(result.survivorReasonSummary).toContain("lexicographically smallest");
  });

  it("with 3+ candidates, ranks all losers and the reason compares the survivor to the next-best runner-up", () => {
    const worst = baseMember({ leadId: "lead-worst", name: "+51900000000", rawPhone: "+51900000000", conversationCount: 0 });
    const middle = baseMember({ leadId: "lead-middle", name: "Juan Pérez", conversationCount: 1 });
    const best = baseMember({ leadId: "lead-best", name: "Juan Pérez", conversationCount: 5 });
    const result = recommendSurvivor([worst, middle, best]);
    expect(result.recommendedSurvivorLeadId).toBe("lead-best");
    expect(result.loserLeadIds.sort()).toEqual(["lead-middle", "lead-worst"].sort());
    expect(result.survivorReasonSummary).toContain("lead-middle"); // compared against the runner-up, not the worst candidate
  });

  it("never mutates its input array or the member objects", () => {
    const members = [baseMember({ leadId: "lead-b" }), baseMember({ leadId: "lead-a" })];
    const snapshot = JSON.stringify(members);
    recommendSurvivor(members);
    expect(JSON.stringify(members)).toBe(snapshot);
  });
});
