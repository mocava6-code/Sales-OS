// Pure unit tests (no DB) for Kori Legacy Data Remediation v0's explicit
// merge-resolution override — commercialProfileCollisionIsResolved. Never
// touches the database; proves the scoping rules in isolation.

import { describe, expect, it } from "vitest";
import { commercialProfileCollisionIsResolved, type ApprovedMergeResolution } from "../merge-resolution";

function planShape(action: "KEEP_SURVIVOR" | "MOVE_LOSER_TO_SURVIVOR" | "NO_PROFILE" | "MANUAL_REVIEW_COLLISION", overrides: { businessId?: string; survivorLeadId?: string; loserLeadId?: string } = {}) {
  return {
    businessId: overrides.businessId ?? "biz-1",
    survivorLeadId: overrides.survivorLeadId ?? "survivor-1",
    loserLeadId: overrides.loserLeadId ?? "loser-1",
    operations: { commercialProfile: { action } } as never,
  };
}

const MATCHING_RESOLUTION: ApprovedMergeResolution = {
  businessId: "biz-1",
  survivorLeadId: "survivor-1",
  loserLeadId: "loser-1",
  commercialProfileCollision: {
    businessId: "biz-1",
    survivorLeadId: "survivor-1",
    loserLeadId: "loser-1",
    resolution: "KEEP_SURVIVOR",
    approvedReason: "test",
    approvedAt: "2026-01-01T00:00:00Z",
  },
};

describe("commercialProfileCollisionIsResolved", () => {
  it("is true when there is no collision at all — nothing to resolve, regardless of resolution presence", () => {
    expect(commercialProfileCollisionIsResolved(planShape("KEEP_SURVIVOR"), undefined)).toBe(true);
    expect(commercialProfileCollisionIsResolved(planShape("MOVE_LOSER_TO_SURVIVOR"), undefined)).toBe(true);
    expect(commercialProfileCollisionIsResolved(planShape("NO_PROFILE"), undefined)).toBe(true);
  });

  it("is false when a collision exists and no resolution is supplied — the default guard holds", () => {
    expect(commercialProfileCollisionIsResolved(planShape("MANUAL_REVIEW_COLLISION"), undefined)).toBe(false);
  });

  it("is true when a collision exists and a matching resolution covers exactly this pair", () => {
    expect(commercialProfileCollisionIsResolved(planShape("MANUAL_REVIEW_COLLISION"), MATCHING_RESOLUTION)).toBe(true);
  });

  it("is false when the resolution is scoped to a DIFFERENT survivor/loser pair — never accidentally unblocks an unrelated collision", () => {
    const wrongPair: ApprovedMergeResolution = { ...MATCHING_RESOLUTION, loserLeadId: "some-other-loser" };
    expect(commercialProfileCollisionIsResolved(planShape("MANUAL_REVIEW_COLLISION"), wrongPair)).toBe(false);
  });

  it("is false when the resolution is scoped to a different business, even with matching lead ids", () => {
    const wrongBusiness: ApprovedMergeResolution = { ...MATCHING_RESOLUTION, businessId: "biz-2" };
    expect(commercialProfileCollisionIsResolved(planShape("MANUAL_REVIEW_COLLISION"), wrongBusiness)).toBe(false);
  });

  it("is false when the resolution object exists but has no commercialProfileCollision entry", () => {
    const noOverride: ApprovedMergeResolution = { businessId: "biz-1", survivorLeadId: "survivor-1", loserLeadId: "loser-1" };
    expect(commercialProfileCollisionIsResolved(planShape("MANUAL_REVIEW_COLLISION"), noOverride)).toBe(false);
  });

  it("is false for the inner collision resolution's own mismatched ids even when the outer wrapper matches", () => {
    const innerMismatch: ApprovedMergeResolution = {
      ...MATCHING_RESOLUTION,
      commercialProfileCollision: { ...MATCHING_RESOLUTION.commercialProfileCollision!, survivorLeadId: "different-survivor" },
    };
    expect(commercialProfileCollisionIsResolved(planShape("MANUAL_REVIEW_COLLISION"), innerMismatch)).toBe(false);
  });
});
