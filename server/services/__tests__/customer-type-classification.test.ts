import { describe, expect, it } from "vitest";
import { classifyCustomerType } from "../customer-type-classification";
import type { FieldProvenance } from "../lead-commercial-profile-service";

function provenance(overrides: Partial<FieldProvenance> = {}): FieldProvenance {
  return { source: "CONVERSATION_SNAPSHOT", confidence: 0.7, snapshotId: "snap-1", updatedAt: "2026-08-14T00:00:00Z", ...overrides };
}

describe("classifyCustomerType", () => {
  it("returns INSUFFICIENT_EVIDENCE when customerType is null, regardless of provenance", () => {
    expect(classifyCustomerType(null, provenance())).toBe("INSUFFICIENT_EVIDENCE");
    expect(classifyCustomerType(null, undefined)).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("returns INSUFFICIENT_EVIDENCE when a value exists but provenance is missing (defensive — should not happen in practice)", () => {
    expect(classifyCustomerType("RETAIL", undefined)).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("returns CONFIRMED for the deterministic tier-3 source — it only ever fires on a literal statement", () => {
    expect(classifyCustomerType("RETAIL", provenance({ source: "LEAD_COMMERCIAL_STATE", confidence: 0.9 }))).toBe("CONFIRMED");
    expect(classifyCustomerType("WHOLESALE", provenance({ source: "LEAD_COMMERCIAL_STATE", confidence: 0.9 }))).toBe("CONFIRMED");
  });

  it("returns CONFIRMED for a human-entered/overridden value", () => {
    expect(classifyCustomerType("RETAIL", provenance({ source: "EXISTING", confidence: 1 }))).toBe("CONFIRMED");
  });

  it("returns CONFIRMED for a high-confidence AI classification (explicit self-identification per prompt rule 5a)", () => {
    expect(classifyCustomerType("WHOLESALE", provenance({ source: "CONVERSATION_SNAPSHOT", confidence: 0.85 }))).toBe("CONFIRMED");
    expect(classifyCustomerType("WHOLESALE", provenance({ source: "CONVERSATION_SNAPSHOT", confidence: 0.95 }))).toBe("CONFIRMED");
  });

  it("returns INFERRED for a moderate-confidence AI classification (contextual judgment per prompt rule 5a)", () => {
    expect(classifyCustomerType("WHOLESALE", provenance({ source: "CONVERSATION_SNAPSHOT", confidence: 0.6 }))).toBe("INFERRED");
    expect(classifyCustomerType("WHOLESALE", provenance({ source: "CONVERSATION_SNAPSHOT", confidence: 0.84 }))).toBe("INFERRED");
  });

  it("treats a missing confidence as the lowest possible (INFERRED, never CONFIRMED by default)", () => {
    expect(classifyCustomerType("RETAIL", provenance({ source: "CONVERSATION_SNAPSHOT", confidence: null }))).toBe("INFERRED");
  });
});
