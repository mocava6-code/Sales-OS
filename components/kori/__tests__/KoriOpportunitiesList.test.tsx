// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { KoriOpportunity } from "@/server/services/kori-briefing-service";
import { KoriOpportunitiesList } from "../KoriOpportunitiesList";

function opportunity(overrides: Partial<KoriOpportunity> = {}): KoriOpportunity {
  return {
    leadId: "lead-1",
    leadName: "María López",
    vehicleLine: "Toyota Hilux",
    reasonCode: "BUYING_SIGNAL",
    kind: "buying_signal",
    waitingSince: new Date("2026-08-12T06:00:00.000Z"),
    ...overrides,
  };
}

describe("KoriOpportunitiesList", () => {
  it("renders nothing when there are no opportunities", () => {
    const { container } = render(<KoriOpportunitiesList opportunities={[]} now={new Date("2026-08-12T12:00:00.000Z")} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the lead name, vehicle line, Spanish reason label, and count", () => {
    render(<KoriOpportunitiesList opportunities={[opportunity()]} now={new Date("2026-08-12T12:00:00.000Z")} />);

    expect(screen.getByText("María López")).toBeInTheDocument();
    expect(screen.getByText(/Toyota Hilux/)).toBeInTheDocument();
    expect(screen.getByText(/Listo para comprar/)).toBeInTheDocument();
    expect(screen.getByText("Señal de compra")).toBeInTheDocument();
    expect(screen.queryByText("BUYING_SIGNAL")).not.toBeInTheDocument();
  });

  it("tags a stalled commitment differently from a buying signal", () => {
    render(
      <KoriOpportunitiesList
        opportunities={[opportunity({ kind: "stalled_commitment", reasonCode: "QUOTATION_PROMISED" })]}
        now={new Date("2026-08-12T12:00:00.000Z")}
      />,
    );

    expect(screen.getByText("Compromiso pendiente")).toBeInTheDocument();
  });

  it("links each opportunity to its lead's detail page", () => {
    render(<KoriOpportunitiesList opportunities={[opportunity({ leadId: "lead-42" })]} now={new Date("2026-08-12T12:00:00.000Z")} />);

    expect(screen.getByRole("link")).toHaveAttribute("href", "/leads/lead-42");
  });
});
