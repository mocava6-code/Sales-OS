import { describe, expect, it } from "vitest";
import { resolveParticipantRoles, roleForSender } from "../role-resolver";

describe("resolveParticipantRoles — deterministic identity match", () => {
  it("matches a participant label against a known business User.name", () => {
    const result = resolveParticipantRoles(["María López", "Juan Pérez"], ["María López"]);

    expect(result).toEqual({ needsInput: false, method: "DETERMINISTIC_USER_MATCH", businessSenderLabel: "María López" });
  });

  it("matches on a shared whole word (contact saved with extra context)", () => {
    const result = resolveParticipantRoles(["María López (Koriaki)", "Juan Pérez"], ["María López"]);

    expect(result).toEqual({
      needsInput: false,
      method: "DETERMINISTIC_USER_MATCH",
      businessSenderLabel: "María López (Koriaki)",
    });
  });

  it("is accent- and case-insensitive", () => {
    const result = resolveParticipantRoles(["maria lopez", "Juan Pérez"], ["María López"]);
    expect(result).toMatchObject({ method: "DETERMINISTIC_USER_MATCH", businessSenderLabel: "maria lopez" });
  });

  it("does not match on a short shared substring alone", () => {
    const result = resolveParticipantRoles(["Ana Li", "Juan Pérez"], ["María Li"]);
    // "Li" is < 3 chars, must not count as a match — falls through to the 2-party prompt instead.
    expect(result.needsInput).toBe(true);
  });
});

describe("resolveParticipantRoles — production regression: business account name, not an individual advisor", () => {
  it("resolves 'Koriaki Import' (the WhatsApp Business account name) when the registered Business.name is included as a known identifier", () => {
    // A WhatsApp Business export's sender label for outbound messages is
    // always the account's own display name, never an individual advisor's
    // — confirmed against a real production export. The caller
    // (server/application/whatsapp-actions.ts's fetchKnownBusinessNames) is
    // responsible for including Business.name alongside every User.name;
    // this test proves the existing word-overlap rule correctly resolves
    // it once that identifier is present, with zero change to this function.
    const result = resolveParticipantRoles(["Koriaki Import", "+51 933 888 197"], ["Mosiah Carrasco", "Koriaki"]);

    expect(result).toEqual({ needsInput: false, method: "DETERMINISTIC_USER_MATCH", businessSenderLabel: "Koriaki Import" });
  });

  it("still requires manual resolution when only individual advisor names are known (the pre-fix behavior, for contrast)", () => {
    const result = resolveParticipantRoles(["Koriaki Import", "+51 933 888 197"], ["Mosiah Carrasco"]);
    expect(result.needsInput).toBe(true);
  });
});

describe("resolveParticipantRoles — manual prompt", () => {
  it("requires input for an unmatched 1:1 chat", () => {
    const result = resolveParticipantRoles(["María López", "Juan Pérez"], []);
    expect(result).toEqual({ needsInput: true, candidateLabels: ["María López", "Juan Pérez"] });
  });

  it("applies a supplied manual answer without re-asking", () => {
    const result = resolveParticipantRoles(["María López", "Juan Pérez"], [], "María López");
    expect(result).toEqual({ needsInput: false, method: "MANUAL_PROMPT", businessSenderLabel: "María López" });
  });

  it("ignores a manual answer that isn't one of the participants", () => {
    const result = resolveParticipantRoles(["María López", "Juan Pérez"], [], "Someone Else");
    // Falls through to the normal resolution path instead of trusting a bogus answer.
    expect(result.needsInput).toBe(true);
  });
});

describe("resolveParticipantRoles — unresolved cases", () => {
  it("never fabricates a role for a group chat (3+ participants)", () => {
    const result = resolveParticipantRoles(["A", "B", "C"], []);
    expect(result).toEqual({ needsInput: false, method: "UNRESOLVED", businessSenderLabel: null });
  });

  it("is UNRESOLVED for a single-participant edge case", () => {
    const result = resolveParticipantRoles(["A"], []);
    expect(result).toEqual({ needsInput: false, method: "UNRESOLVED", businessSenderLabel: null });
  });
});

describe("roleForSender", () => {
  it("maps the resolved business label to BUSINESS and the other party to CUSTOMER", () => {
    expect(roleForSender("María López", "María López", 2)).toBe("BUSINESS");
    expect(roleForSender("Juan Pérez", "María López", 2)).toBe("CUSTOMER");
  });

  it("is UNKNOWN when no business label is resolved", () => {
    expect(roleForSender("María López", null, 2)).toBe("UNKNOWN");
  });

  it("is UNKNOWN for anything other than exactly 2 participants, even with a resolved label", () => {
    expect(roleForSender("María López", "María López", 3)).toBe("UNKNOWN");
  });
});
