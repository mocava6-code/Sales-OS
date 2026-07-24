// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ObservationTimelineEntryDTO } from "@/server/observer-console/types";
import { DetectorInfoPanel } from "../DetectorInfoPanel";

function observation(overrides: Partial<ObservationTimelineEntryDTO> = {}): ObservationTimelineEntryDTO {
  return {
    id: "obs-1",
    type: "PRICE_REQUEST",
    summary: "Customer asked about price.",
    evidenceExcerpt: "cuánto cuesta?",
    detector: {
      detectorId: "keyword.price_request",
      kind: "keyword",
      description: "Associated with a keyword/pattern detector.",
      keywordSample: ["precio", "cuánto cuesta"],
    },
    occurredAt: "2026-07-20T12:00:00.000Z",
    ...overrides,
  };
}

describe("DetectorInfoPanel", () => {
  it("shows the detector id, kind, and description", () => {
    render(<DetectorInfoPanel observation={observation()} />);

    expect(screen.getByText(/keyword.price_request/)).toBeInTheDocument();
    expect(screen.getByText("Associated with a keyword/pattern detector.")).toBeInTheDocument();
  });

  it("labels the keyword sample explicitly as not the exact match", () => {
    render(<DetectorInfoPanel observation={observation()} />);

    expect(screen.getByText(/Sample keywords \(not the exact match\)/)).toBeInTheDocument();
    expect(screen.getByText(/precio, cuánto cuesta/)).toBeInTheDocument();
  });

  it("omits the keyword sample line for a temporal detector with none", () => {
    render(
      <DetectorInfoPanel
        observation={observation({
          type: "CUSTOMER_GHOSTED",
          evidenceExcerpt: null,
          detector: { detectorId: "temporal.customer_ghosted", kind: "temporal", description: "d" },
        })}
      />,
    );

    expect(screen.queryByText(/Sample keywords/)).not.toBeInTheDocument();
  });

  it("shows the message excerpt when present, omits it when null", () => {
    const { rerender } = render(<DetectorInfoPanel observation={observation()} />);
    expect(screen.getByText(/cuánto cuesta\?/)).toBeInTheDocument();

    rerender(<DetectorInfoPanel observation={observation({ evidenceExcerpt: null })} />);
    expect(screen.queryByText("Message excerpt")).not.toBeInTheDocument();
  });
});
