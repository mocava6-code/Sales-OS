// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HistoricalImportNudge } from "../HistoricalImportNudge";

describe("HistoricalImportNudge", () => {
  it("shows the nudge, linked to the import page, when show is true", () => {
    render(<HistoricalImportNudge show={true} />);
    expect(screen.getByText(/Dale a Kori tu historial de WhatsApp/)).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/settings/whatsapp/import");
  });

  it("renders nothing when show is false", () => {
    render(<HistoricalImportNudge show={false} />);
    expect(screen.queryByText(/Dale a Kori tu historial de WhatsApp/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
