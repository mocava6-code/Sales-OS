// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PendingDecisionPreview } from "@/server/services/decision-service";
import { KoriDecisionsPreview } from "../KoriDecisionsPreview";

describe("KoriDecisionsPreview", () => {
  it("shows a calm, honest empty state — never a blank void — when there is nothing to review", () => {
    render(<KoriDecisionsPreview decisions={[]} now={new Date("2026-08-12T12:00:00.000Z")} />);

    expect(screen.getByText(/Todavía no hay decisiones que revisar/)).toBeInTheDocument();
  });

  it("lists each pending decision with its lead and links to the review page", () => {
    const decisions: PendingDecisionPreview[] = [
      { id: "dec-1", title: "Responder consulta de precio", type: "RESPOND_TO_CUSTOMER", leadId: "lead-1", leadName: "Antonio Trujillo", createdAt: new Date("2026-08-12T09:00:00.000Z") },
    ];

    render(<KoriDecisionsPreview decisions={decisions} now={new Date("2026-08-12T12:00:00.000Z")} />);

    expect(screen.getByText("Responder consulta de precio")).toBeInTheDocument();
    expect(screen.getByText("Antonio Trujillo")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/decisions/dec-1");
    expect(screen.queryByText(/Todavía no hay decisiones/)).not.toBeInTheDocument();
  });
});
