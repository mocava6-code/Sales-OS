import { describe, expect, it } from "vitest";
import { buildExecutiveSummary, deriveDataQualityCard, deriveInsightCards, deriveOpportunityCard, deriveProblemCard, deriveTrendCard } from "../kori-insights-service";
import type { KoriNeedsOutcomeNudge } from "../kori-briefing-service";
import type { ProductPerformance, ProductPerformanceSummary } from "@/server/insights/product-performance";
import type { LossAnalysis } from "@/server/insights/loss-analysis";
import type { CustomerTypeCoverage, DataQualityField, DataQualityStat } from "@/server/insights/data-quality";

function nudge(overrides: Partial<KoriNeedsOutcomeNudge> = {}): KoriNeedsOutcomeNudge {
  return { leadId: "lead-1", leadName: "Cliente", vehicleLine: "Ranger Raptor", reasonCode: "BUYING_SIGNAL", waitingSince: new Date("2026-08-01T00:00:00.000Z"), ...overrides };
}

function product(overrides: Partial<ProductPerformance> = {}): ProductPerformance {
  return { product: "Kit TRAVO", interested: 0, interestedPreviousPeriod: 0, trendPercent: null, closed: 0, lost: 0, decided: 0, conversionRate: null, classification: null, ...overrides };
}

function performanceSummary(products: ProductPerformance[]): ProductPerformanceSummary {
  return { products, periodDays: 30 };
}

function lossAnalysis(overrides: Partial<LossAnalysis> = {}): LossAnalysis {
  return { totalLost: 0, lostReasonBreakdown: [], responseTimeBuckets: [], responseTimeInsight: null, ...overrides };
}

function dataQualityStats(overrides: Partial<Record<DataQualityField, Partial<DataQualityStat>>> = {}): DataQualityStat[] {
  const fields: DataQualityField[] = ["customerType", "vehicleBrand", "productInterest"];
  return fields.map((field) => ({ field, missingCount: 0, totalCount: 10, missingPercentage: 0, ...overrides[field] }));
}

function customerTypeCoverage(overrides: Partial<CustomerTypeCoverage> = {}): CustomerTypeCoverage {
  return { totalCount: 10, confirmedCount: 0, inferredRetailCount: 0, inferredWholesaleCount: 0, insufficientEvidenceCount: 10, ...overrides };
}

describe("deriveOpportunityCard", () => {
  it("flags the largest product cluster among leads with no recorded outcome", () => {
    const card = deriveOpportunityCard([nudge({ vehicleLine: "Ranger Raptor" }), nudge({ vehicleLine: "Ranger Raptor" }), nudge({ vehicleLine: "Hilux" })]);
    expect(card).toEqual({ type: "OPORTUNIDAD", text: "2 clientes preguntaron por Ranger Raptor pero no han recibido seguimiento." });
  });

  it("returns null when no product cluster reaches the minimum size", () => {
    expect(deriveOpportunityCard([nudge({ vehicleLine: "Ranger Raptor" }), nudge({ vehicleLine: "Hilux" })])).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(deriveOpportunityCard([])).toBeNull();
  });

  it("ignores nudges with no vehicleLine", () => {
    expect(deriveOpportunityCard([nudge({ vehicleLine: null }), nudge({ vehicleLine: null })])).toBeNull();
  });
});

describe("deriveTrendCard", () => {
  it("picks the product with the strongest growth above the minimum thresholds", () => {
    const card = deriveTrendCard(performanceSummary([product({ product: "Hilux TRAVO", interested: 10, trendPercent: 35 }), product({ product: "Kit menor", interested: 5, trendPercent: 60 })]));
    expect(card).toEqual({ type: "TENDENCIA", text: "Las consultas sobre Kit menor aumentaron 60% en el último mes." });
  });

  it("never claims a timeframe other than the actual computed window", () => {
    const card = deriveTrendCard(performanceSummary([product({ interested: 10, trendPercent: 50 })]));
    expect(card?.text).not.toContain("esta semana");
    expect(card?.text).toContain("último mes");
  });

  it("returns null when no product has enough interest to trust its trend", () => {
    expect(deriveTrendCard(performanceSummary([product({ interested: 1, trendPercent: 100 })]))).toBeNull();
  });

  it("returns null when growth doesn't clear the minimum percentage", () => {
    expect(deriveTrendCard(performanceSummary([product({ interested: 10, trendPercent: 5 })]))).toBeNull();
  });

  it("returns null when trendPercent is null (no previous-period baseline)", () => {
    expect(deriveTrendCard(performanceSummary([product({ interested: 10, trendPercent: null })]))).toBeNull();
  });
});

describe("deriveProblemCard", () => {
  it("passes through loss-analysis.ts's own gated response-time insight unchanged", () => {
    const card = deriveProblemCard(lossAnalysis({ responseTimeInsight: "Los clientes que reciben respuesta rápido convierten mejor." }));
    expect(card).toEqual({ type: "PROBLEMA", text: "Los clientes que reciben respuesta rápido convierten mejor." });
  });

  it("returns null when there is no gated insight", () => {
    expect(deriveProblemCard(lossAnalysis())).toBeNull();
  });
});

describe("deriveDataQualityCard", () => {
  it("names the field with the highest missing percentage above the threshold — non-customerType fields state concrete counts, not just a bare percentage", () => {
    const card = deriveDataQualityCard(
      dataQualityStats({ vehicleBrand: { missingCount: 6, missingPercentage: 60 }, productInterest: { missingCount: 5, missingPercentage: 50 } }),
      customerTypeCoverage(),
    );
    expect(card).toEqual({
      type: "DATO_FALTANTE",
      text: "Kori necesita más información sobre la marca del vehículo — identificado en 4 de 10 clientes (6 sin este dato, 60%).",
    });
  });

  it("productInterest: a percentage can rise purely from new, not-yet-classified leads arriving — the count-based wording makes that legible instead of reading as a regression", () => {
    // Real production shape: 79% -> 80% explained entirely by 4 new leads
    // (total 62 -> 66) that haven't been classified yet, not by anything
    // already-classified becoming unclassified.
    const before = deriveDataQualityCard(dataQualityStats({ productInterest: { missingCount: 49, totalCount: 62, missingPercentage: 79 } }), customerTypeCoverage());
    const after = deriveDataQualityCard(dataQualityStats({ productInterest: { missingCount: 53, totalCount: 66, missingPercentage: 80 } }), customerTypeCoverage());

    expect(before?.text).toContain("identificado en 13 de 62 clientes (49 sin este dato, 79%)");
    expect(after?.text).toContain("identificado en 13 de 66 clientes (53 sin este dato, 80%)");
  });

  it("returns null when no field clears the missing-percentage threshold", () => {
    expect(deriveDataQualityCard(dataQualityStats({ customerType: { missingCount: 3, missingPercentage: 30 } }), customerTypeCoverage())).toBeNull();
  });

  it("returns null when the business doesn't have enough leads to trust a percentage", () => {
    expect(deriveDataQualityCard(dataQualityStats({ customerType: { totalCount: 2, missingCount: 2, missingPercentage: 100 } }), customerTypeCoverage())).toBeNull();
  });

  it("customerType uses the richer Confirmado/Inferido/Sin evidencia breakdown, never the plain 'no tienen este dato' wording", () => {
    const card = deriveDataQualityCard(
      dataQualityStats({ customerType: { missingCount: 46, missingPercentage: 74 } }),
      customerTypeCoverage({ totalCount: 62, confirmedCount: 15, inferredRetailCount: 0, inferredWholesaleCount: 0, insufficientEvidenceCount: 47 }),
    );
    expect(card?.type).toBe("DATO_FALTANTE");
    expect(card?.text).toContain("Kori tiene el tipo de cliente confirmado en 24% de tus clientes.");
    expect(card?.text).toContain("76% todavía no tienen evidencia suficiente.");
    expect(card?.text).not.toContain("no tienen este dato");
  });

  it("customerType breakdown mentions inferred RETAIL/WHOLESALE splits only when at least one lead actually has that signal", () => {
    const withInferred = deriveDataQualityCard(
      dataQualityStats({ customerType: { missingPercentage: 50 } }),
      customerTypeCoverage({ inferredRetailCount: 3, inferredWholesaleCount: 1, insufficientEvidenceCount: 6 }),
    );
    expect(withInferred?.text).toContain("muestran señales de ser cliente final");
    expect(withInferred?.text).toContain("muestran señales de ser distribuidor o mayorista");

    const withoutInferred = deriveDataQualityCard(
      dataQualityStats({ customerType: { missingPercentage: 50 } }),
      customerTypeCoverage({ inferredRetailCount: 0, inferredWholesaleCount: 0, insufficientEvidenceCount: 10 }),
    );
    expect(withoutInferred?.text).not.toContain("señales");
  });

  it("never presents an inferred count as confirmed — the confirmed percentage only ever reflects confirmedCount", () => {
    const card = deriveDataQualityCard(
      dataQualityStats({ customerType: { missingPercentage: 50 } }),
      customerTypeCoverage({ totalCount: 10, confirmedCount: 2, inferredRetailCount: 5, insufficientEvidenceCount: 3 }),
    );
    expect(card?.text).toContain("confirmado en 20%");
  });
});

describe("deriveInsightCards", () => {
  it("combines every available card type, dropping nulls", () => {
    const cards = deriveInsightCards(
      performanceSummary([product({ product: "Kit menor", interested: 10, trendPercent: 50 })]),
      lossAnalysis({ responseTimeInsight: "Insight de pérdidas." }),
      [nudge(), nudge()],
      dataQualityStats({ customerType: { missingCount: 6, missingPercentage: 60 } }),
      customerTypeCoverage({ insufficientEvidenceCount: 6 }),
    );
    expect(cards.map((c) => c.type)).toEqual(["OPORTUNIDAD", "TENDENCIA", "PROBLEMA", "DATO_FALTANTE"]);
  });

  it("returns an empty array when nothing clears any threshold", () => {
    expect(deriveInsightCards(performanceSummary([]), lossAnalysis(), [], dataQualityStats(), customerTypeCoverage())).toEqual([]);
  });
});

describe("buildExecutiveSummary", () => {
  it("always reports the conversation count, singular for exactly one", () => {
    expect(buildExecutiveSummary(1, performanceSummary([]), lossAnalysis(), 0)).toBe("Recibimos 1 conversación comercial este mes.");
  });

  it("uses plural grammar for any other count", () => {
    expect(buildExecutiveSummary(42, performanceSummary([]), lossAnalysis(), 0)).toBe("Recibimos 42 conversaciones comerciales este mes.");
  });

  it("appends the top-growing product when one clears the threshold", () => {
    const summary = buildExecutiveSummary(10, performanceSummary([product({ product: "Hilux TRAVO", interested: 10, trendPercent: 35 })]), lossAnalysis(), 0);
    expect(summary).toContain("El producto con mayor crecimiento fue Hilux TRAVO (+35%).");
  });

  it("appends the top lost reason, lowercased, when one exists", () => {
    const summary = buildExecutiveSummary(10, performanceSummary([]), lossAnalysis({ lostReasonBreakdown: [{ reason: "PRECIO", label: "Precio", count: 3, percentage: 60 }] }), 0);
    expect(summary).toContain("La principal razón de pérdida fue precio.");
  });

  it("appends the needs-outcome count, singular for exactly one", () => {
    const summary = buildExecutiveSummary(10, performanceSummary([]), lossAnalysis(), 1);
    expect(summary).toContain("Hay 1 cliente con alta intención sin seguimiento.");
  });

  it("appends the needs-outcome count, plural otherwise", () => {
    const summary = buildExecutiveSummary(10, performanceSummary([]), lossAnalysis(), 8);
    expect(summary).toContain("Hay 8 clientes con alta intención sin seguimiento.");
  });

  it("omits every optional clause when there is nothing to say", () => {
    expect(buildExecutiveSummary(0, performanceSummary([]), lossAnalysis(), 0)).toBe("Recibimos 0 conversaciones comerciales este mes.");
  });
});
