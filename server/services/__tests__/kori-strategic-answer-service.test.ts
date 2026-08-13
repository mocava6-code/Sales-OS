import { describe, expect, it } from "vitest";
import { buildMainWeaknessAnswer, buildTopOpportunityAnswer, buildWhereToInvestAnswer } from "../kori-strategic-answer-service";
import type { ProductPerformance, ProductPerformanceSummary } from "@/server/insights/product-performance";
import type { LossAnalysis } from "@/server/insights/loss-analysis";

function product(overrides: Partial<ProductPerformance> = {}): ProductPerformance {
  return { product: "Kit TRAVO", interested: 0, interestedPreviousPeriod: 0, trendPercent: null, closed: 0, lost: 0, decided: 0, conversionRate: null, classification: null, ...overrides };
}

function performance(products: ProductPerformance[]): ProductPerformanceSummary {
  return { products, periodDays: 30 };
}

function lossAnalysis(overrides: Partial<LossAnalysis> = {}): LossAnalysis {
  return { totalLost: 0, lostReasonBreakdown: [], responseTimeBuckets: [], responseTimeInsight: null, ...overrides };
}

describe("buildTopOpportunityAnswer", () => {
  it("names the OPORTUNIDAD_MEJORA product and its actual conversion rate", () => {
    const answer = buildTopOpportunityAnswer(performance([product({ product: "Hilux TRAVO", conversionRate: 0.25, classification: "OPORTUNIDAD_MEJORA" })]));
    expect(answer).toBe("Basado en conversaciones y resultados, Hilux TRAVO tiene mayor potencial: alta demanda pero solo 25% de conversión — hay margen real de mejora ahí.");
  });

  it("falls back to the ESTRELLA product when there is no OPORTUNIDAD_MEJORA product", () => {
    const answer = buildTopOpportunityAnswer(performance([product({ product: "Kit de embrague", conversionRate: 0.8, classification: "ESTRELLA" })]));
    expect(answer).toContain("Kit de embrague ya es tu producto más fuerte");
    expect(answer).toContain("80% de conversión");
  });

  it("prefers OPORTUNIDAD_MEJORA over ESTRELLA when both exist", () => {
    const answer = buildTopOpportunityAnswer(
      performance([product({ product: "Estrella", classification: "ESTRELLA" }), product({ product: "Oportunidad", classification: "OPORTUNIDAD_MEJORA" })]),
    );
    expect(answer).toContain("Oportunidad");
    expect(answer).not.toContain("Estrella");
  });

  it("gives an honest no-data answer when nothing is classified", () => {
    const answer = buildTopOpportunityAnswer(performance([product({ classification: null })]));
    expect(answer).toBe("Todavía no hay suficiente información sobre productos y resultados este mes para recomendar uno en particular.");
  });
});

describe("buildMainWeaknessAnswer", () => {
  it("leads with the follow-up gap when the needs-outcome count is notable", () => {
    const answer = buildMainWeaknessAnswer(14, lossAnalysis());
    expect(answer).toBe("El principal punto débil es el seguimiento: 14 clientes con intención alta no tienen un resultado registrado todavía.");
  });

  it("falls back to the response-time insight when the follow-up gap is small", () => {
    const answer = buildMainWeaknessAnswer(1, lossAnalysis({ responseTimeInsight: "Los clientes que reciben respuesta rápido convierten mejor." }));
    expect(answer).toBe("Los clientes que reciben respuesta rápido convierten mejor.");
  });

  it("falls back to a dominant lost reason when there's no response-time insight", () => {
    const answer = buildMainWeaknessAnswer(0, lossAnalysis({ lostReasonBreakdown: [{ reason: "PRECIO", label: "Precio", count: 6, percentage: 60 }] }));
    expect(answer).toBe("La mayoría de las ventas perdidas (60%) son por precio — ahí está el mayor punto de mejora.");
  });

  it("never names a lost reason that isn't actually dominant", () => {
    const answer = buildMainWeaknessAnswer(0, lossAnalysis({ lostReasonBreakdown: [{ reason: "PRECIO", label: "Precio", count: 2, percentage: 40 }] }));
    expect(answer).not.toContain("Precio");
  });

  it("gives an honest no-problem answer when nothing stands out", () => {
    const answer = buildMainWeaknessAnswer(0, lossAnalysis());
    expect(answer).toBe("No se detectó un problema dominante todavía — los resultados de este mes están relativamente parejos.");
  });
});

describe("buildWhereToInvestAnswer", () => {
  it("names up to two ESTRELLA products", () => {
    const answer = buildWhereToInvestAnswer(performance([product({ product: "Toyota Hilux", classification: "ESTRELLA" }), product({ product: "Ford Ranger", classification: "ESTRELLA" })]));
    expect(answer).toBe("Los datos muestran mayor intención combinada con buena conversión en Toyota Hilux y Ford Ranger.");
  });

  it("never recommends more than two products even with more ESTRELLA candidates", () => {
    const answer = buildWhereToInvestAnswer(
      performance([product({ product: "A", classification: "ESTRELLA" }), product({ product: "B", classification: "ESTRELLA" }), product({ product: "C", classification: "ESTRELLA" })]),
    );
    expect(answer).not.toContain("C");
  });

  it("falls back to top-interest products with a caveat when there is no ESTRELLA yet", () => {
    const answer = buildWhereToInvestAnswer(performance([product({ product: "Ranger Raptor", interested: 5, classification: null })]));
    expect(answer).toContain("Ranger Raptor");
    expect(answer).toContain("todavía no hay suficientes ventas decididas");
  });

  it("gives an honest no-data answer when nothing clears the interest threshold", () => {
    const answer = buildWhereToInvestAnswer(performance([product({ interested: 1 })]));
    expect(answer).toBe("Todavía no hay suficiente información para recomendar dónde invertir.");
  });
});
