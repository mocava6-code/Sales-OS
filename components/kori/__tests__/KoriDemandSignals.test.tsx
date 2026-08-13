// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KoriDemandSignals } from "../KoriDemandSignals";

describe("KoriDemandSignals", () => {
  it("shows a graceful message instead of empty bars when the sample is too small", () => {
    render(<KoriDemandSignals demandSignals={[]} demandWindowDays={7} demandSampleSize={0} />);
    expect(screen.getByText(/Todavía no hay suficientes clientes nuevos/)).toBeInTheDocument();
  });

  it("shows the raw count next to the percentage — never only the percentage", () => {
    render(
      <KoriDemandSignals
        demandSignals={[{ label: "Toyota Hilux", count: 18, percentage: 41 }]}
        demandWindowDays={7}
        demandSampleSize={44}
      />,
    );

    expect(screen.getByText("Toyota Hilux")).toBeInTheDocument();
    expect(screen.getByText("18 · 41%")).toBeInTheDocument();
    expect(screen.getByText(/Sobre 44 clientes registrados/)).toBeInTheDocument();
  });

  it("labels the window length in the section title", () => {
    render(<KoriDemandSignals demandSignals={[]} demandWindowDays={7} demandSampleSize={0} />);
    expect(screen.getByText(/últimos 7 días/)).toBeInTheDocument();
  });
});
