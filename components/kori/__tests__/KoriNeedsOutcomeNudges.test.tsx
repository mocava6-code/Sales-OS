// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { KoriNeedsOutcomeNudge } from "@/server/services/kori-briefing-service";
import { KoriNeedsOutcomeNudges } from "../KoriNeedsOutcomeNudges";

function nudge(overrides: Partial<KoriNeedsOutcomeNudge> = {}): KoriNeedsOutcomeNudge {
  return {
    leadId: "lead-1",
    leadName: "María López",
    vehicleLine: "Toyota Hilux",
    reasonCode: "BUYING_SIGNAL",
    waitingSince: new Date("2026-08-06T06:00:00.000Z"),
    ...overrides,
  };
}

describe("KoriNeedsOutcomeNudges", () => {
  it("renders nothing when there are no nudges", () => {
    const { container } = render(<KoriNeedsOutcomeNudges nudges={[]} now={new Date("2026-08-13T12:00:00.000Z")} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the lead name, vehicle line, and Spanish reason label, never a raw reason code", () => {
    render(<KoriNeedsOutcomeNudges nudges={[nudge()]} now={new Date("2026-08-13T12:00:00.000Z")} />);

    expect(screen.getByText("María López")).toBeInTheDocument();
    expect(screen.getByText(/Toyota Hilux/)).toBeInTheDocument();
    expect(screen.getByText(/Listo para comprar/)).toBeInTheDocument();
    expect(screen.queryByText("BUYING_SIGNAL")).not.toBeInTheDocument();
  });

  it("shows the heading question and the nudge count", () => {
    render(<KoriNeedsOutcomeNudges nudges={[nudge(), nudge({ leadId: "lead-2" })]} now={new Date("2026-08-13T12:00:00.000Z")} />);

    expect(screen.getByText("¿Qué pasó con estos clientes?")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("links each nudge to its lead's detail page", () => {
    render(<KoriNeedsOutcomeNudges nudges={[nudge({ leadId: "lead-42" })]} now={new Date("2026-08-13T12:00:00.000Z")} />);

    expect(screen.getByRole("link")).toHaveAttribute("href", "/leads/lead-42");
  });
});
