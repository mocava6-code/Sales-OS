import { describe, expect, it } from "vitest";
import { DETECTOR_REGISTRY } from "../detector-registry";

// The full ObservationType enum is intentionally hand-listed here (not
// imported and enumerated at runtime — string union types have no runtime
// representation) so this test fails loudly the moment a new
// ObservationType ships without a registry entry, catching *coverage*
// drift. It cannot catch *content* drift (a keyword list changing without
// keywordSample being updated) — see ARCHITECTURE.md §20's known risks.
const ALL_OBSERVATION_TYPES = [
  "PRICE_REQUEST",
  "COMPATIBILITY_QUESTION",
  "INSTALLATION_QUESTION",
  "CUSTOMER_GHOSTED",
  "PHOTO_REQUEST",
  "DISCOUNT_NEGOTIATION",
  "QUOTE_REQUEST",
  "AVAILABILITY_REQUEST",
  "DELIVERY_TIME_REQUEST",
  "PAYMENT_METHOD_REQUEST",
  "PRICE_OBJECTION",
  "AVAILABILITY_FRICTION",
  "DELIVERY_LOCATION_FRICTION",
  "INSTALLATION_FRICTION",
  "TRUST_FRICTION",
  "TIMING_FRICTION",
  "LIMA_MENTIONED",
  "PROVINCE_MENTIONED",
] as const;

describe("DETECTOR_REGISTRY completeness", () => {
  it("has exactly one entry per ObservationType — no missing, no extra", () => {
    expect(Object.keys(DETECTOR_REGISTRY).sort()).toEqual([...ALL_OBSERVATION_TYPES].sort());
  });

  it.each(ALL_OBSERVATION_TYPES)("%s has a non-empty detectorId and description", (type) => {
    const entry = DETECTOR_REGISTRY[type];
    expect(entry.detectorId.length).toBeGreaterThan(0);
    expect(entry.description.length).toBeGreaterThan(0);
    expect(["keyword", "temporal"]).toContain(entry.kind);
  });

  it("never claims to identify the exact matched keyword or a computed elapsed time", () => {
    for (const entry of Object.values(DETECTOR_REGISTRY)) {
      expect(entry.description.toLowerCase()).not.toMatch(/matched keyword|exact match|computed gap/);
    }
  });
});
