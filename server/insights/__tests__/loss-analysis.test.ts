import { describe, expect, it } from "vitest";
import { buildResponseTimeInsight, deriveLossReasonBreakdown, deriveResponseTimeBuckets } from "../loss-analysis";

describe("deriveLossReasonBreakdown", () => {
  it("counts and computes percentage per reason", () => {
    const result = deriveLossReasonBreakdown([{ lostReason: "PRECIO" }, { lostReason: "PRECIO" }, { lostReason: "DEJO_DE_RESPONDER" }, { lostReason: "PRECIO" }]);

    expect(result).toEqual([
      { reason: "PRECIO", label: "Precio", count: 3, percentage: 75 },
      { reason: "DEJO_DE_RESPONDER", label: "Dejó de responder", count: 1, percentage: 25 },
    ]);
  });

  it("ignores outcomes with no lostReason recorded", () => {
    const result = deriveLossReasonBreakdown([{ lostReason: null }, { lostReason: "PRECIO" }]);
    expect(result).toEqual([{ reason: "PRECIO", label: "Precio", count: 1, percentage: 100 }]);
  });

  it("returns an empty array when there are no lost outcomes", () => {
    expect(deriveLossReasonBreakdown([])).toEqual([]);
  });

  it("sorts by count descending", () => {
    const result = deriveLossReasonBreakdown([{ lostReason: "OTRO" }, { lostReason: "PRECIO" }, { lostReason: "PRECIO" }]);
    expect(result.map((r) => r.reason)).toEqual(["PRECIO", "OTRO"]);
  });
});

describe("deriveResponseTimeBuckets", () => {
  it("buckets decided outcomes and computes conversion rate per bucket", () => {
    const result = deriveResponseTimeBuckets([
      { outcomeType: "SALE_CLOSED", responseMinutes: 10 },
      { outcomeType: "SALE_LOST", responseMinutes: 15 },
      { outcomeType: "SALE_CLOSED", responseMinutes: 2000 },
      { outcomeType: "SALE_LOST", responseMinutes: 2500 },
      { outcomeType: "SALE_LOST", responseMinutes: 3000 },
    ]);

    const under30 = result.find((b) => b.bucket === "UNDER_30_MIN")!;
    expect(under30).toMatchObject({ decided: 2, closed: 1, conversionRate: 0.5 });

    const over24h = result.find((b) => b.bucket === "OVER_24H")!;
    expect(over24h).toMatchObject({ decided: 3, closed: 1, conversionRate: 1 / 3 });
  });

  it("always returns all four buckets, even when empty", () => {
    const result = deriveResponseTimeBuckets([]);
    expect(result.map((b) => b.bucket)).toEqual(["UNDER_30_MIN", "30_MIN_TO_2H", "2H_TO_24H", "OVER_24H"]);
    expect(result.every((b) => b.decided === 0 && b.conversionRate === null)).toBe(true);
  });

  it("excludes outcomes with no computable response time from every bucket", () => {
    const result = deriveResponseTimeBuckets([{ outcomeType: "SALE_CLOSED", responseMinutes: null }]);
    expect(result.every((b) => b.decided === 0)).toBe(true);
  });
});

describe("buildResponseTimeInsight", () => {
  function buckets(overrides: { under30?: Partial<{ decided: number; closed: number }>; over24h?: Partial<{ decided: number; closed: number }> } = {}) {
    const under30 = { decided: 5, closed: 4, ...overrides.under30 };
    const over24h = { decided: 5, closed: 1, ...overrides.over24h };
    return [
      { bucket: "UNDER_30_MIN" as const, label: "", decided: under30.decided, closed: under30.closed, conversionRate: under30.decided > 0 ? under30.closed / under30.decided : null },
      { bucket: "30_MIN_TO_2H" as const, label: "", decided: 0, closed: 0, conversionRate: null },
      { bucket: "2H_TO_24H" as const, label: "", decided: 0, closed: 0, conversionRate: null },
      { bucket: "OVER_24H" as const, label: "", decided: over24h.decided, closed: over24h.closed, conversionRate: over24h.decided > 0 ? over24h.closed / over24h.decided : null },
    ];
  }

  it("builds a comparison sentence when the fast bucket converts meaningfully better", () => {
    const insight = buildResponseTimeInsight(buckets());
    expect(insight).toBe("Los clientes que reciben respuesta en menos de 30 minutos convierten 80% de las veces, frente a 20% cuando la respuesta toma más de 24 horas.");
  });

  it("returns null when the fast bucket has too few decided outcomes", () => {
    expect(buildResponseTimeInsight(buckets({ under30: { decided: 2, closed: 2 } }))).toBeNull();
  });

  it("returns null when the slow bucket has too few decided outcomes", () => {
    expect(buildResponseTimeInsight(buckets({ over24h: { decided: 1, closed: 0 } }))).toBeNull();
  });

  it("returns null when the fast bucket does not actually convert better", () => {
    expect(buildResponseTimeInsight(buckets({ under30: { decided: 5, closed: 1 }, over24h: { decided: 5, closed: 4 } }))).toBeNull();
  });

  it("returns null when both buckets convert identically", () => {
    expect(buildResponseTimeInsight(buckets({ under30: { decided: 5, closed: 2 }, over24h: { decided: 5, closed: 2 } }))).toBeNull();
  });
});
