// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KoriAlertsList } from "../KoriAlertsList";

describe("KoriAlertsList", () => {
  it("renders nothing when there is nothing to alert on", () => {
    const { container } = render(<KoriAlertsList alerts={{ staleReplyCount: 0, unassignedHighPriorityCount: 0 }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("uses singular grammar for exactly one stale conversation", () => {
    render(<KoriAlertsList alerts={{ staleReplyCount: 1, unassignedHighPriorityCount: 0 }} />);
    expect(screen.getByText("1 conversación lleva más de 48 horas sin respuesta.")).toBeInTheDocument();
  });

  it("uses plural grammar for multiple stale conversations", () => {
    render(<KoriAlertsList alerts={{ staleReplyCount: 3, unassignedHighPriorityCount: 0 }} />);
    expect(screen.getByText("3 conversaciones llevan más de 48 horas sin respuesta.")).toBeInTheDocument();
  });

  it("shows both alerts together when both are non-zero", () => {
    render(<KoriAlertsList alerts={{ staleReplyCount: 2, unassignedHighPriorityCount: 1 }} />);
    expect(screen.getByText(/2 conversaciones llevan/)).toBeInTheDocument();
    expect(screen.getByText("1 cliente de alta prioridad está sin asesor asignado.")).toBeInTheDocument();
  });
});
