// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DomainEventTimelineEntryDTO } from "@/server/observer-console/types";
import { UnmatchedEventsPanel } from "../UnmatchedEventsPanel";

function event(overrides: Partial<DomainEventTimelineEntryDTO> = {}): DomainEventTimelineEntryDTO {
  return {
    id: "event-1",
    eventType: "MESSAGE_SENT",
    occurredAt: "2026-07-20T12:15:00.000Z",
    conversationEntry: null,
    observations: [],
    ...overrides,
  };
}

describe("UnmatchedEventsPanel", () => {
  it("renders nothing when there are no unmatched events", () => {
    const { container } = render(<UnmatchedEventsPanel events={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the count and lists every unmatched event", () => {
    render(<UnmatchedEventsPanel events={[event(), event({ id: "event-2", eventType: "CONVERSATION_CLOSED" })]} />);

    expect(screen.getByText("Events with no observations (2)")).toBeInTheDocument();
    expect(screen.getByText(/MESSAGE_SENT/)).toBeInTheDocument();
    expect(screen.getByText(/CONVERSATION_CLOSED/)).toBeInTheDocument();
  });
});
