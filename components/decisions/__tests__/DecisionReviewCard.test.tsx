// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DecisionSummaryDTO } from "@/server/application/dto";
import { DecisionReviewCard } from "../DecisionReviewCard";

function buildDecision(overrides: Partial<DecisionSummaryDTO> = {}): DecisionSummaryDTO {
  return {
    id: "decision-1",
    conversationId: "conv-1",
    conversationSnapshotId: "snapshot-1",
    type: "RESPOND_TO_CUSTOMER",
    title: "Confirm compatibility before quoting",
    recommendation: "Ask the customer to confirm the exact Hilux trim before quoting a price.",
    objective: "Avoid quoting an incompatible kit",
    reasoning: "Vehicle year and trim are not yet verified.",
    evidence: [{ sourceType: "conversation_message", sourceId: "message-0", excerpt: "Hilux 2022" }],
    assumptions: [],
    missingInformation: [{ field: "vehicleTrim", reason: "not mentioned yet" }],
    alternatives: [
      { title: "Quote the base trim", recommendation: "Quote the base trim price.", tradeoff: "Might be wrong." },
    ],
    confidence: 0.7,
    riskLevel: "MEDIUM",
    impactLevel: "MEDIUM",
    approvalRequirement: "ADVISOR_APPROVAL_REQUIRED",
    suggestedAction: { description: "Ask for the exact trim.", autoPerformable: false },
    status: "PROPOSED",
    warnings: [],
    metadata: {
      engineSchemaVersion: 1,
      promptVersion: "kori-decision-v1",
      aiProvider: "anthropic",
      modelName: "claude-test",
      decidedAt: new Date("2026-07-18T12:05:00.000Z"),
    },
    createdAt: new Date("2026-07-18T12:05:00.000Z"),
    ...overrides,
  };
}

describe("DecisionReviewCard — 12. renders recommendation, reasoning, risk, evidence, and status", () => {
  it("renders the title, recommendation, reasoning, and status", () => {
    render(<DecisionReviewCard decision={buildDecision()} />);

    expect(screen.getByText("Confirm compatibility before quoting")).toBeInTheDocument();
    expect(
      screen.getByText("Ask the customer to confirm the exact Hilux trim before quoting a price."),
    ).toBeInTheDocument();
    expect(screen.getByText("Vehicle year and trim are not yet verified.")).toBeInTheDocument();
    expect(screen.getByText("Propuesta")).toBeInTheDocument();
  });

  it("renders risk, impact, confidence, and approval requirement badges", () => {
    render(<DecisionReviewCard decision={buildDecision()} />);

    expect(screen.getByText("Riesgo medio")).toBeInTheDocument();
    expect(screen.getByText("Impacto medio")).toBeInTheDocument();
    expect(screen.getByText("Confianza 70%")).toBeInTheDocument();
    expect(screen.getByText("Necesita aprobación del asesor")).toBeInTheDocument();
  });

  it("renders evidence entries", () => {
    render(<DecisionReviewCard decision={buildDecision()} />);
    expect(screen.getByText(/Hilux 2022/)).toBeInTheDocument();
  });

  it("renders missing information and alternatives when present", () => {
    render(<DecisionReviewCard decision={buildDecision()} />);
    expect(screen.getByText(/vehicleTrim/)).toBeInTheDocument();
    expect(screen.getByText("Quote the base trim")).toBeInTheDocument();
  });

  it("omits the evidence section entirely when there is none", () => {
    render(<DecisionReviewCard decision={buildDecision({ evidence: [] })} />);
    expect(screen.queryByText("Evidencia")).not.toBeInTheDocument();
  });

  it("shows model/provider/prompt version metadata inside the collapsible technical section", () => {
    render(<DecisionReviewCard decision={buildDecision()} />);

    const details = screen.getByText("Detalles técnicos").closest("details");
    expect(details).not.toBeNull();
    expect(screen.getByText("claude-test")).toBeInTheDocument();
    expect(screen.getByText("kori-decision-v1")).toBeInTheDocument();
  });

  it.each(["PROPOSED", "APPROVED", "REJECTED", "EXECUTED", "OVERRIDDEN"] as const)(
    "renders the correct label for status %s",
    (status) => {
      render(<DecisionReviewCard decision={buildDecision({ status })} />);
      const labels: Record<string, string> = {
        PROPOSED: "Propuesta",
        APPROVED: "Aprobada",
        REJECTED: "Rechazada",
        EXECUTED: "Ejecutada",
        OVERRIDDEN: "Reemplazada por el asesor",
      };
      expect(screen.getByText(labels[status])).toBeInTheDocument();
    },
  );
});
