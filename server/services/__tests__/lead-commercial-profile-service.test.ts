import { describe, expect, it } from "vitest";
import { LEAD_COMMERCIAL_PROFILE_CONFIDENCE_THRESHOLD, resolveField } from "../lead-commercial-profile-service";

function tier2(value: string, confidence = 0.8) {
  return { value, confidence, source: "CONVERSATION_SNAPSHOT" as const, snapshotId: "snap-1" };
}

function tier3(value: string, confidence = 0.85) {
  return { value, confidence, source: "LEAD_COMMERCIAL_STATE" as const, snapshotId: null };
}

describe("resolveField", () => {
  it("returns null when neither tier has a candidate", () => {
    expect(resolveField(undefined, null, null)).toBeNull();
  });

  it("tier-2 candidate wins when there is no existing confidence to compare against", () => {
    const result = resolveField(undefined, tier2("Toyota"), null);
    expect(result).toMatchObject({ value: "Toyota", source: "CONVERSATION_SNAPSHOT" });
  });

  it("tier-2 wins over tier-3 when both are valid candidates", () => {
    const result = resolveField(undefined, tier2("Hilux"), tier3("Hilux 2022"));
    expect(result).toMatchObject({ value: "Hilux", source: "CONVERSATION_SNAPSHOT" });
  });

  it("falls back to tier-3 when tier-2 has no candidate", () => {
    const result = resolveField(undefined, null, tier3("Hilux 2022"));
    expect(result).toMatchObject({ value: "Hilux 2022", source: "LEAD_COMMERCIAL_STATE" });
  });

  it("rejects a new candidate with strictly lower confidence than the existing value", () => {
    const result = resolveField(0.9, tier2("Toyota", 0.7), tier3("Toyota", 0.7));
    expect(result).toBeNull();
  });

  it("accepts a new candidate whose confidence is equal to the existing value's", () => {
    const result = resolveField(0.8, tier2("Toyota", 0.8), null);
    expect(result).toMatchObject({ value: "Toyota" });
  });

  it("accepts a new candidate with higher confidence than the existing value", () => {
    const result = resolveField(0.6, tier2("Toyota", 0.9), null);
    expect(result).toMatchObject({ value: "Toyota", confidence: 0.9 });
  });

  it("a null-valued field never produces a candidate at all — never a null overwrite", () => {
    // Simulates buildTier2Candidate/buildTier3Candidate's own null-value gate:
    // callers never construct a FieldCandidate wrapping value: null, they
    // pass null itself (see buildTier2Candidate/buildTier3Candidate).
    const result = resolveField(0.9, null, null);
    expect(result).toBeNull();
  });
});

describe("LEAD_COMMERCIAL_PROFILE_CONFIDENCE_THRESHOLD", () => {
  it("is 0.6", () => {
    expect(LEAD_COMMERCIAL_PROFILE_CONFIDENCE_THRESHOLD).toBe(0.6);
  });
});
