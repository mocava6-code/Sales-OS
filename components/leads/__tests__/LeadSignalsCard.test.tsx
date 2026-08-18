// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LeadSignalSummary } from "@/server/services/lead-signal-service";
import { LeadSignalsCard } from "../LeadSignalsCard";

function signal(overrides: Partial<LeadSignalSummary> = {}): LeadSignalSummary {
  return {
    type: "PRICE_OBJECTION",
    count: 1,
    lastOccurredAt: new Date("2026-08-12T06:00:00.000Z"),
    latestExcerpt: "está muy caro",
    ...overrides,
  };
}

describe("LeadSignalsCard", () => {
  it("renders nothing when there are no signals", () => {
    const { container } = render(<LeadSignalsCard signals={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the Spanish label, count, and excerpt for a signal", () => {
    render(<LeadSignalsCard signals={[signal({ count: 3 })]} />);

    expect(screen.getByText(/Le pareció caro/)).toBeInTheDocument();
    expect(screen.getByText(/\(3\)/)).toBeInTheDocument();
    expect(screen.getByText(/está muy caro/)).toBeInTheDocument();
    expect(screen.queryByText("PRICE_OBJECTION")).not.toBeInTheDocument();
  });

  it("omits the count suffix when there's only one occurrence", () => {
    render(<LeadSignalsCard signals={[signal({ count: 1 })]} />);
    expect(screen.queryByText(/\(1\)/)).not.toBeInTheDocument();
  });

  it("sorts friction signals before intent and geography signals", () => {
    render(
      <LeadSignalsCard
        signals={[
          signal({ type: "LIMA_MENTIONED", count: 1, latestExcerpt: null }),
          signal({ type: "QUOTE_REQUEST", count: 1, latestExcerpt: "quiero cotizar" }),
          signal({ type: "TRUST_FRICTION", count: 1, latestExcerpt: "es confiable?" }),
        ]}
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Dudó de la confianza del negocio");
    expect(items[1]).toHaveTextContent("Pidió una cotización");
    expect(items[2]).toHaveTextContent("Mencionó Lima");
  });

  it("never shows an excerpt when none was captured", () => {
    render(<LeadSignalsCard signals={[signal({ latestExcerpt: null })]} />);
    expect(screen.queryByText(/["“”]/)).not.toBeInTheDocument();
  });
});
