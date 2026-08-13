// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DecisionActions } from "../DecisionActions";

vi.mock("@/server/actions/decisions", () => ({
  approveDecisionAction: vi.fn(),
  rejectDecisionAction: vi.fn(),
  executeDecisionAction: vi.fn(),
  recordAdvisorOverrideAction: vi.fn(),
}));

describe("DecisionActions — 13. rendered buttons match status and authorization", () => {
  it("PROPOSED + ADVISOR_APPROVAL_REQUIRED: shows approve, reject, and override for a SALESPERSON", () => {
    render(
      <DecisionActions
        decisionRecordId="d-1"
        status="PROPOSED"
        role="SALESPERSON"
        approvalRequirement="ADVISOR_APPROVAL_REQUIRED"
      />,
    );

    expect(screen.getByRole("button", { name: "Aprobar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar cambio" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar como ejecutada" })).not.toBeInTheDocument();
  });

  it("PROPOSED + ADMIN_APPROVAL_REQUIRED: hides Approve for a SALESPERSON", () => {
    render(
      <DecisionActions
        decisionRecordId="d-1"
        status="PROPOSED"
        role="SALESPERSON"
        approvalRequirement="ADMIN_APPROVAL_REQUIRED"
      />,
    );

    expect(screen.queryByRole("button", { name: "Aprobar" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeInTheDocument();
  });

  it("PROPOSED + ADMIN_APPROVAL_REQUIRED: shows Approve for an OWNER", () => {
    render(
      <DecisionActions
        decisionRecordId="d-1"
        status="PROPOSED"
        role="OWNER"
        approvalRequirement="ADMIN_APPROVAL_REQUIRED"
      />,
    );

    expect(screen.getByRole("button", { name: "Aprobar" })).toBeInTheDocument();
  });

  it("APPROVED: shows execute, reject, and override", () => {
    render(
      <DecisionActions
        decisionRecordId="d-1"
        status="APPROVED"
        role="SALESPERSON"
        approvalRequirement="ADVISOR_APPROVAL_REQUIRED"
      />,
    );

    expect(screen.getByRole("button", { name: "Marcar como ejecutada" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar cambio" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aprobar" })).not.toBeInTheDocument();
  });

  it("EXECUTED: shows no action buttons, only a terminal-state message", () => {
    render(
      <DecisionActions
        decisionRecordId="d-1"
        status="EXECUTED"
        role="OWNER"
        approvalRequirement="ADVISOR_APPROVAL_REQUIRED"
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/ejecutada/i)).toBeInTheDocument();
  });

  it("clicking Reject shows a required note field before the confirm button is enabled", () => {
    render(
      <DecisionActions
        decisionRecordId="d-1"
        status="PROPOSED"
        role="SALESPERSON"
        approvalRequirement="ADVISOR_APPROVAL_REQUIRED"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));

    const confirmButton = screen.getByRole("button", { name: "Confirmar: rechazar" });
    expect(confirmButton).toBeDisabled();
    expect(screen.getByLabelText("¿Por qué estás rechazando esto?")).toBeInTheDocument();
  });
});
