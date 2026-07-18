import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../policy-evaluator";

describe("evaluatePolicy", () => {
  it("requires human information when missingInformation touches a protected category, regardless of risk/impact", () => {
    const result = evaluatePolicy({
      type: "RESPOND_TO_CUSTOMER",
      riskLevel: "LOW",
      impactLevel: "LOW",
      missingInformation: [{ field: "price", reason: "not verified" }],
    });
    expect(result).toBe("HUMAN_INFORMATION_REQUIRED");
  });

  it("requires admin approval for CRITICAL risk", () => {
    const result = evaluatePolicy({
      type: "RESPOND_TO_CUSTOMER",
      riskLevel: "CRITICAL",
      impactLevel: "MEDIUM",
      missingInformation: [],
    });
    expect(result).toBe("ADMIN_APPROVAL_REQUIRED");
  });

  it("requires advisor approval for HIGH risk or HIGH impact", () => {
    expect(
      evaluatePolicy({ type: "FOLLOW_UP", riskLevel: "HIGH", impactLevel: "LOW", missingInformation: [] }),
    ).toBe("ADVISOR_APPROVAL_REQUIRED");
    expect(
      evaluatePolicy({ type: "RECOMMEND_SALES_APPROACH", riskLevel: "MEDIUM", impactLevel: "HIGH", missingInformation: [] }),
    ).toBe("ADVISOR_APPROVAL_REQUIRED");
  });

  it("auto-allows an eligible low-risk, low-impact type", () => {
    const result = evaluatePolicy({
      type: "ORGANIZE_CONVERSATION",
      riskLevel: "LOW",
      impactLevel: "LOW",
      missingInformation: [],
    });
    expect(result).toBe("AUTO_ALLOWED");
  });

  it("never auto-allows a type that isn't explicitly eligible, even at LOW/LOW", () => {
    const result = evaluatePolicy({
      type: "RESPOND_TO_CUSTOMER",
      riskLevel: "LOW",
      impactLevel: "LOW",
      missingInformation: [],
    });
    expect(result).toBe("ADVISOR_APPROVAL_REQUIRED");
  });
});
