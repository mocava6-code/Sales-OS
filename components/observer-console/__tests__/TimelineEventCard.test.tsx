// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DomainEventTimelineEntryDTO } from "@/server/observer-console/types";
import { TimelineEventCard } from "../TimelineEventCard";

function event(overrides: Partial<DomainEventTimelineEntryDTO> = {}): DomainEventTimelineEntryDTO {
  return {
    id: "event-1",
    eventType: "MESSAGE_RECEIVED",
    occurredAt: "2026-07-20T12:00:00.000Z",
    conversationEntry: {
      id: "entry-1",
      direction: "INBOUND",
      content: "cuánto cuesta?",
      messageType: "TEXT",
      occurredAt: "2026-07-20T12:00:00.000Z",
    },
    observations: [],
    ...overrides,
  };
}

describe("TimelineEventCard", () => {
  it("renders the event type label and the conversation entry's content", () => {
    render(<TimelineEventCard event={event()} />);

    expect(screen.getByText("Message received")).toBeInTheDocument();
    expect(screen.getByText(/cuánto cuesta\?/)).toBeInTheDocument();
  });

  it("shows a 'no observations' message when the event derived none", () => {
    render(<TimelineEventCard event={event({ observations: [] })} />);

    expect(screen.getByText("No observations derived from this event.")).toBeInTheDocument();
  });

  it("renders one ObservationBadge per derived observation", () => {
    render(
      <TimelineEventCard
        event={event({
          observations: [
            {
              id: "obs-1",
              type: "PRICE_REQUEST",
              summary: "Customer asked about price.",
              evidenceExcerpt: "cuánto cuesta?",
              detector: { detectorId: "keyword.price_request", kind: "keyword", description: "d", keywordSample: ["precio"] },
              occurredAt: "2026-07-20T12:00:00.000Z",
            },
            {
              id: "obs-2",
              type: "DISCOUNT_NEGOTIATION",
              summary: "Customer asked for a discount.",
              evidenceExcerpt: "cuánto cuesta?",
              detector: { detectorId: "keyword.discount_negotiation", kind: "keyword", description: "d" },
              occurredAt: "2026-07-20T12:00:00.000Z",
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("PRICE_REQUEST")).toBeInTheDocument();
    expect(screen.getByText("DISCOUNT_NEGOTIATION")).toBeInTheDocument();
    expect(screen.queryByText("No observations derived from this event.")).not.toBeInTheDocument();
  });

  it("renders no conversation entry content for a conversation-level event", () => {
    render(
      <TimelineEventCard
        event={event({ eventType: "CONVERSATION_CREATED", conversationEntry: null, observations: [] })}
      />,
    );

    expect(screen.getByText("Conversation created")).toBeInTheDocument();
    expect(screen.queryByText(/\[INBOUND\]/)).not.toBeInTheDocument();
  });
});
