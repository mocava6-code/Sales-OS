// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { KoriInsightsSummary } from "@/server/services/kori-insights-service";
import { KoriInsights } from "../KoriInsights";

function insights(overrides: Partial<KoriInsightsSummary> = {}): KoriInsightsSummary {
  return { executiveSummary: "Recibimos 42 conversaciones comerciales este mes.", cards: [], productPerformance: [], periodDays: 30, ...overrides };
}

describe("KoriInsights", () => {
  it("always shows the executive summary", () => {
    render(<KoriInsights insights={insights()} />);
    expect(screen.getByText("Recibimos 42 conversaciones comerciales este mes.")).toBeInTheDocument();
  });

  it("renders each insight card with its icon and text, never a raw type name", () => {
    render(
      <KoriInsights
        insights={insights({
          cards: [
            { type: "OPORTUNIDAD", text: "15 clientes preguntaron por Ranger Raptor pero no han recibido seguimiento." },
            { type: "TENDENCIA", text: "Las consultas sobre Hilux TRAVO aumentaron 35% en el último mes." },
            { type: "PROBLEMA", text: "Los clientes que esperan más de 24 horas convierten peor." },
          ],
        })}
      />,
    );

    expect(screen.getByText(/15 clientes preguntaron por Ranger Raptor/)).toBeInTheDocument();
    expect(screen.getByText(/Hilux TRAVO aumentaron 35%/)).toBeInTheDocument();
    expect(screen.getByText(/esperan más de 24 horas/)).toBeInTheDocument();
    expect(screen.getByText("🚨")).toBeInTheDocument();
    expect(screen.getByText("📈")).toBeInTheDocument();
    expect(screen.getByText("⚠️")).toBeInTheDocument();
    expect(screen.queryByText("OPORTUNIDAD")).not.toBeInTheDocument();
  });

  it("renders nothing extra when there are no cards", () => {
    render(<KoriInsights insights={insights({ cards: [] })} />);
    expect(screen.queryByText("🚨")).not.toBeInTheDocument();
  });

  it("shows the product performance list with interest count and conversion rate", () => {
    render(
      <KoriInsights
        insights={insights({
          productPerformance: [
            { product: "Kit TRAVO", interested: 20, interestedPreviousPeriod: 15, trendPercent: 33, closed: 5, lost: 15, decided: 20, conversionRate: 0.25, classification: "OPORTUNIDAD_MEJORA" },
          ],
        })}
      />,
    );

    expect(screen.getByText("Kit TRAVO")).toBeInTheDocument();
    expect(screen.getByText(/20 interesados/)).toBeInTheDocument();
    expect(screen.getByText(/25% conversión/)).toBeInTheDocument();
  });

  it("omits the conversion clause for a product with no decided outcomes yet", () => {
    render(
      <KoriInsights
        insights={insights({
          productPerformance: [{ product: "Ranger Raptor", interested: 5, interestedPreviousPeriod: 0, trendPercent: null, closed: 0, lost: 0, decided: 0, conversionRate: null, classification: null }],
        })}
      />,
    );

    expect(screen.getByText("5 interesados")).toBeInTheDocument();
    expect(screen.queryByText(/conversión/)).not.toBeInTheDocument();
  });

  it("uses singular grammar for exactly one interested lead", () => {
    render(
      <KoriInsights
        insights={insights({
          productPerformance: [{ product: "Ranger Raptor", interested: 1, interestedPreviousPeriod: 0, trendPercent: null, closed: 0, lost: 0, decided: 0, conversionRate: null, classification: null }],
        })}
      />,
    );
    expect(screen.getByText("1 interesado")).toBeInTheDocument();
  });
});
