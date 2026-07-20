import { describe, expect, it } from "vitest";
import { getAvailableDecisionActions, requiresNote } from "../available-actions";

describe("getAvailableDecisionActions — 13. available UI actions match status and authorization", () => {
  it("PROPOSED + ADVISOR_APPROVAL_REQUIRED: any role sees approve/reject/override", () => {
    expect(getAvailableDecisionActions("PROPOSED", "SALESPERSON", "ADVISOR_APPROVAL_REQUIRED")).toEqual([
      "APPROVE",
      "REJECT",
      "OVERRIDE",
    ]);
    expect(getAvailableDecisionActions("PROPOSED", "OWNER", "ADVISOR_APPROVAL_REQUIRED")).toEqual([
      "APPROVE",
      "REJECT",
      "OVERRIDE",
    ]);
  });

  it("PROPOSED + ADMIN_APPROVAL_REQUIRED: a SALESPERSON sees reject/override but not approve", () => {
    expect(getAvailableDecisionActions("PROPOSED", "SALESPERSON", "ADMIN_APPROVAL_REQUIRED")).toEqual([
      "REJECT",
      "OVERRIDE",
    ]);
  });

  it("PROPOSED + ADMIN_APPROVAL_REQUIRED: an OWNER sees approve too", () => {
    expect(getAvailableDecisionActions("PROPOSED", "OWNER", "ADMIN_APPROVAL_REQUIRED")).toEqual([
      "APPROVE",
      "REJECT",
      "OVERRIDE",
    ]);
  });

  it("PROPOSED + AUTO_ALLOWED / HUMAN_INFORMATION_REQUIRED: not gated (only ADMIN_APPROVAL_REQUIRED restricts approve)", () => {
    expect(getAvailableDecisionActions("PROPOSED", "SALESPERSON", "AUTO_ALLOWED")).toContain("APPROVE");
    expect(getAvailableDecisionActions("PROPOSED", "SALESPERSON", "HUMAN_INFORMATION_REQUIRED")).toContain("APPROVE");
  });

  it("APPROVED: execute/reject/override are always available regardless of role", () => {
    expect(getAvailableDecisionActions("APPROVED", "SALESPERSON", "ADVISOR_APPROVAL_REQUIRED")).toEqual([
      "EXECUTE",
      "REJECT",
      "OVERRIDE",
    ]);
    expect(getAvailableDecisionActions("APPROVED", "OWNER", "ADMIN_APPROVAL_REQUIRED")).toEqual([
      "EXECUTE",
      "REJECT",
      "OVERRIDE",
    ]);
  });

  it.each(["REJECTED", "EXECUTED", "CANCELLED", "OVERRIDDEN"] as const)(
    "%s is terminal: no actions available for either role",
    (status) => {
      expect(getAvailableDecisionActions(status, "SALESPERSON", "ADVISOR_APPROVAL_REQUIRED")).toEqual([]);
      expect(getAvailableDecisionActions(status, "OWNER", "ADMIN_APPROVAL_REQUIRED")).toEqual([]);
    },
  );
});

describe("requiresNote", () => {
  it("REJECT and OVERRIDE require a note", () => {
    expect(requiresNote("REJECT")).toBe(true);
    expect(requiresNote("OVERRIDE")).toBe(true);
  });

  it("APPROVE and EXECUTE do not require a note", () => {
    expect(requiresNote("APPROVE")).toBe(false);
    expect(requiresNote("EXECUTE")).toBe(false);
  });
});
