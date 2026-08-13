// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KoriStatStrip } from "../KoriStatStrip";

describe("KoriStatStrip", () => {
  it("renders all four Spanish labels with their values", () => {
    render(<KoriStatStrip stats={{ replyRequiredCount: 14, overdueFollowUpCount: 6, newLeadsThisWeek: 5, pendingDecisionsCount: 0 }} />);

    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("Requieren respuesta")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("Seguimientos vencidos")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Nuevos esta semana")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("Decisiones por revisar")).toBeInTheDocument();
  });
});
