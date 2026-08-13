// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { KoriInsightsSummary } from "@/server/services/kori-insights-service";
import { KoriInsights } from "../KoriInsights";

function insights(overrides: Partial<KoriInsightsSummary> = {}): KoriInsightsSummary {
  return { executiveSummary: "Recibimos 42 conversaciones comerciales este mes.", cards: [], productPerformance: [], periodDays: 30, showHistoricalImportNudge: false, ...overrides };
}

describe("KoriInsights", () => {
  it("always shows the executive summary", () => {
    render(<KoriInsights insights={insights()} canImportHistory={false} />);
    expect(screen.getByText("Recibimos 42 conversaciones comerciales este mes.")).toBeInTheDocument();
  });

  it("renders each insight card with its icon and text, never a raw type name", () => {
    render(
      <KoriInsights
        canImportHistory={false}
        insights={insights({
          cards: [
            { type: "OPORTUNIDAD", text: "15 clientes preguntaron por Ranger Raptor pero no han recibido seguimiento." },
            { type: "TENDENCIA", text: "Las consultas sobre Hilux TRAVO aumentaron 35% en el último mes." },
            { type: "PROBLEMA", text: "Los clientes que esperan más de 24 horas convierten peor." },
            { type: "DATO_FALTANTE", text: "Kori necesita más información sobre el tipo de cliente — 60% de tus clientes no tienen este dato." },
          ],
        })}
      />,
    );

    expect(screen.getByText(/15 clientes preguntaron por Ranger Raptor/)).toBeInTheDocument();
    expect(screen.getByText(/Hilux TRAVO aumentaron 35%/)).toBeInTheDocument();
    expect(screen.getByText(/esperan más de 24 horas/)).toBeInTheDocument();
    expect(screen.getByText(/Kori necesita más información/)).toBeInTheDocument();
    expect(screen.getByText("🚨")).toBeInTheDocument();
    expect(screen.getByText("📈")).toBeInTheDocument();
    expect(screen.getByText("⚠️")).toBeInTheDocument();
    expect(screen.getByText("🔍")).toBeInTheDocument();
    expect(screen.queryByText("OPORTUNIDAD")).not.toBeInTheDocument();
  });

  it("renders nothing extra when there are no cards", () => {
    render(<KoriInsights insights={insights({ cards: [] })} canImportHistory={false} />);
    expect(screen.queryByText("🚨")).not.toBeInTheDocument();
  });

  it("shows the product performance list with interest count and conversion rate", () => {
    render(
      <KoriInsights
        canImportHistory={false}
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
        canImportHistory={false}
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
        canImportHistory={false}
        insights={insights({
          productPerformance: [{ product: "Ranger Raptor", interested: 1, interestedPreviousPeriod: 0, trendPercent: null, closed: 0, lost: 0, decided: 0, conversionRate: null, classification: null }],
        })}
      />,
    );
    expect(screen.getByText("1 interesado")).toBeInTheDocument();
  });

  describe("historical import nudge", () => {
    it("shows the nudge, linked to the import page, when there's no import yet and the viewer can import", () => {
      render(<KoriInsights insights={insights({ showHistoricalImportNudge: true })} canImportHistory={true} />);
      expect(screen.getByText(/Kori solo ve tus conversaciones desde que conectaste WhatsApp/)).toBeInTheDocument();
      expect(screen.getByRole("link")).toHaveAttribute("href", "/settings/whatsapp/import");
    });

    it("hides the nudge once a business has imported history", () => {
      render(<KoriInsights insights={insights({ showHistoricalImportNudge: false })} canImportHistory={true} />);
      expect(screen.queryByText(/Kori solo ve tus conversaciones/)).not.toBeInTheDocument();
    });

    it("hides the nudge from a viewer who can't import history, even when it would otherwise show", () => {
      render(<KoriInsights insights={insights({ showHistoricalImportNudge: true })} canImportHistory={false} />);
      expect(screen.queryByText(/Kori solo ve tus conversaciones/)).not.toBeInTheDocument();
    });
  });
});
