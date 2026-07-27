import { describe, expect, it } from "vitest";
import { deriveCandidateStatus } from "../candidate-status";

describe("deriveCandidateStatus — from NEW", () => {
  it("stays NEW with no classifications", () => {
    expect(deriveCandidateStatus("NEW", [])).toBe("NEW");
  });

  it("becomes REINFORCED on an EQUIVALENT classification", () => {
    expect(deriveCandidateStatus("NEW", ["EQUIVALENT"])).toBe("REINFORCED");
  });

  it("becomes CONFLICT on a CONTRADICTORY classification", () => {
    expect(deriveCandidateStatus("NEW", ["CONTRADICTORY"])).toBe("CONFLICT");
  });

  it("CONTRADICTORY wins over a simultaneous EQUIVALENT", () => {
    expect(deriveCandidateStatus("NEW", ["EQUIVALENT", "CONTRADICTORY"])).toBe("CONFLICT");
  });

  it("stays NEW for RELATED/UNRELATED only", () => {
    expect(deriveCandidateStatus("NEW", ["RELATED", "UNRELATED"])).toBe("NEW");
  });
});

describe("deriveCandidateStatus — CONFLICT is sticky", () => {
  it("a later EQUIVALENT classification never reverts CONFLICT to REINFORCED", () => {
    expect(deriveCandidateStatus("CONFLICT", ["EQUIVALENT"])).toBe("CONFLICT");
  });

  it("stays CONFLICT even with no new classifications at all", () => {
    expect(deriveCandidateStatus("CONFLICT", [])).toBe("CONFLICT");
  });

  it("stays CONFLICT regardless of further CONTRADICTORY evidence", () => {
    expect(deriveCandidateStatus("CONFLICT", ["CONTRADICTORY"])).toBe("CONFLICT");
  });
});

describe("deriveCandidateStatus — from REINFORCED", () => {
  it("stays REINFORCED with no new classifications", () => {
    expect(deriveCandidateStatus("REINFORCED", [])).toBe("REINFORCED");
  });

  it("moves to CONFLICT the first time a CONTRADICTORY classification appears", () => {
    expect(deriveCandidateStatus("REINFORCED", ["CONTRADICTORY"])).toBe("CONFLICT");
  });
});
