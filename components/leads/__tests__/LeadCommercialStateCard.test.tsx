// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LeadCommercialStateDTO } from "@/server/lead-commercial-state/types";
import { LeadCommercialStateCard } from "../LeadCommercialStateCard";

function workedExampleState(): LeadCommercialStateDTO {
  return {
    productInterest: { value: "Hilux TRAVO 2026 kit", confidence: 0.6, evidenceExcerpt: "tiene kit de hilux travo 2026?", reasoning: null },
    vehicleModel: { value: "Hilux TRAVO 2026", confidence: 0.6, evidenceExcerpt: "tiene kit de hilux travo 2026?", reasoning: null },
    deliveryLocation: { value: "Chaclacayo", confidence: 0.85, evidenceExcerpt: "hace envíos a chaclacayo?", reasoning: "Matched against a known Peru district/city gazetteer." },
    requestedDeliveryAt: { value: "2026-07-25T17:00:00.000Z", confidence: 0.75, evidenceExcerpt: "para manana a las 12", reasoning: null },
    paymentStatus: { value: "AWAITING_PAYMENT", confidence: 0.85, evidenceExcerpt: "ok aqui le paso el numero de cuenta para que realice el pago", reasoning: null },
    lastContactAt: "2026-07-24T14:25:00.000Z",
    lastContactDirection: "OUTBOUND",
    conversationState: "WAITING_ON_CUSTOMER",
    nextAction: { value: "CONFIRM_PAYMENT", confidence: 1, evidenceExcerpt: null, reasoning: "The advisor requested payment and no confirmation has been observed yet." },
    followUpDueAt: { value: "2026-07-24T18:25:00.000Z", confidence: 1, evidenceExcerpt: null, reasoning: "4h SLA for CONFIRM_PAYMENT, applied to the last contact at 2026-07-24T14:25:00.000Z." },
    activeConversationId: "conv-1",
    derivedAt: "2026-07-24T18:30:00.000Z",
  };
}

describe("LeadCommercialStateCard", () => {
  it("renders every required field from the worked example", () => {
    render(<LeadCommercialStateCard state={workedExampleState()} />);

    expect(screen.getByText("Hilux TRAVO 2026 kit")).toBeInTheDocument();
    expect(screen.getByText("Hilux TRAVO 2026")).toBeInTheDocument();
    expect(screen.getByText("Chaclacayo")).toBeInTheDocument();
    expect(screen.getByText("Awaiting payment")).toBeInTheDocument();
    expect(screen.getByText("Waiting on customer")).toBeInTheDocument();
    expect(screen.getByText("Confirm payment")).toBeInTheDocument();
  });

  it("shows an evidence/reasoning affordance for fields that have one", () => {
    render(<LeadCommercialStateCard state={workedExampleState()} />);

    const whyToggles = screen.getAllByText("why?");
    expect(whyToggles.length).toBeGreaterThan(0);
    expect(screen.getByText(/Matched against a known Peru district\/city gazetteer/)).toBeInTheDocument();
  });

  it("renders a placeholder for fields with no resolved value", () => {
    const state = workedExampleState();
    state.deliveryLocation = { value: null, confidence: 0, evidenceExcerpt: null, reasoning: null };

    render(<LeadCommercialStateCard state={state} />);

    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders no editable inputs — this is a read-only card", () => {
    render(<LeadCommercialStateCard state={workedExampleState()} />);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
