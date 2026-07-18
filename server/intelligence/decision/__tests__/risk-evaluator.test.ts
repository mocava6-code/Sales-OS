import { describe, expect, it } from "vitest";
import { evaluateRisk } from "../risk-evaluator";

describe("evaluateRisk", () => {
  it("uses a low base risk/impact for low-stakes decision types", () => {
    const result = evaluateRisk({
      type: "ORGANIZE_CONVERSATION",
      hasUngroundedProtectedClaim: false,
      hasCommerciallyRiskyFraming: false,
    });
    expect(result).toEqual({ riskLevel: "LOW", impactLevel: "LOW" });
  });

  it("treats RECOMMEND_SALES_APPROACH as high-impact by default, per the phase spec", () => {
    const result = evaluateRisk({
      type: "RECOMMEND_SALES_APPROACH",
      hasUngroundedProtectedClaim: false,
      hasCommerciallyRiskyFraming: false,
    });
    expect(result.impactLevel).toBe("HIGH");
  });

  it("escalates to HIGH risk/impact when a protected claim is ungrounded, regardless of type", () => {
    const result = evaluateRisk({
      type: "ORGANIZE_CONVERSATION",
      hasUngroundedProtectedClaim: true,
      hasCommerciallyRiskyFraming: false,
    });
    expect(result.riskLevel).toBe("HIGH");
    expect(result.impactLevel).toBe("HIGH");
  });

  it("escalates to HIGH risk/impact for commercially risky framing (discount/pressure/promise)", () => {
    const result = evaluateRisk({
      type: "FOLLOW_UP",
      hasUngroundedProtectedClaim: false,
      hasCommerciallyRiskyFraming: true,
    });
    expect(result.riskLevel).toBe("HIGH");
    expect(result.impactLevel).toBe("HIGH");
  });

  it("never downgrades an already-high base impact", () => {
    const result = evaluateRisk({
      type: "RECOMMEND_SALES_APPROACH",
      hasUngroundedProtectedClaim: false,
      hasCommerciallyRiskyFraming: true,
    });
    expect(result.impactLevel).toBe("HIGH");
  });
});
