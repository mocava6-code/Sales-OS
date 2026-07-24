// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ObservationCatalogTable } from "../ObservationCatalogTable";

describe("ObservationCatalogTable", () => {
  it("shows a placeholder message when there are no observations yet", () => {
    render(<ObservationCatalogTable counts={[]} />);

    expect(screen.getByText("No observations recorded yet.")).toBeInTheDocument();
  });

  it("renders one row per observed type with count and last-seen date", () => {
    render(
      <ObservationCatalogTable
        counts={[
          { type: "PRICE_REQUEST", count: 3, lastSeenAt: "2026-07-24T09:00:00.000Z" },
          { type: "CUSTOMER_GHOSTED", count: 1, lastSeenAt: null },
        ]}
      />,
    );

    expect(screen.getByText("PRICE_REQUEST")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("CUSTOMER_GHOSTED")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
