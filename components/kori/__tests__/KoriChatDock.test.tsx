// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KoriChatDock } from "../KoriChatDock";

vi.mock("@/server/actions/kori", () => ({
  askKoriAction: vi.fn(),
}));

import { askKoriAction } from "@/server/actions/kori";

describe("KoriChatDock", () => {
  it("shows starter suggestions before any question has been asked", () => {
    render(<KoriChatDock />);

    expect(screen.getByText("¿Cuántos clientes necesitan respuesta?")).toBeInTheDocument();
  });

  it("sends the typed question and renders Kori's answer", async () => {
    vi.mocked(askKoriAction).mockResolvedValue({
      ok: true,
      data: {
        kind: "operational",
        question: "¿Cuántos clientes necesitan respuesta?",
        querySpec: { operation: "COUNT_LEADS", filters: { needsReply: true }, limit: 25 },
        result: { answer: "Hay 14 clientes que necesitan respuesta.", type: "count", count: 14 },
        metadata: { generatedAt: "2026-08-12T12:00:00.000Z", timezone: "America/Lima" },
      },
    });

    render(<KoriChatDock />);

    fireEvent.change(screen.getByPlaceholderText("Pregúntale a Kori…"), { target: { value: "¿Cuántos clientes necesitan respuesta?" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar pregunta" }));

    expect(screen.getByText("¿Cuántos clientes necesitan respuesta?")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Hay 14 clientes que necesitan respuesta.")).toBeInTheDocument());
    expect(askKoriAction).toHaveBeenCalledWith({ question: "¿Cuántos clientes necesitan respuesta?" });
  });

  it("shows a safe error message when Kori can't answer, never a raw error code", async () => {
    vi.mocked(askKoriAction).mockResolvedValue({
      ok: false,
      error: { code: "UNSUPPORTED_QUESTION", message: "Kori todavía no puede responder ese tipo de consulta." },
    });

    render(<KoriChatDock />);

    fireEvent.change(screen.getByPlaceholderText("Pregúntale a Kori…"), { target: { value: "¿Cuál es el sentido de la vida?" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar pregunta" }));

    await waitFor(() => expect(screen.getByText("Kori todavía no puede responder ese tipo de consulta.")).toBeInTheDocument());
    expect(screen.queryByText("UNSUPPORTED_QUESTION")).not.toBeInTheDocument();
  });

  it("switches to follow-up suggestions after the first question", async () => {
    vi.mocked(askKoriAction).mockResolvedValue({
      ok: true,
      data: {
        kind: "operational",
        question: "test",
        querySpec: { operation: "COUNT_LEADS", filters: {}, limit: 25 },
        result: { answer: "Respuesta.", type: "count", count: 1 },
        metadata: { generatedAt: "2026-08-12T12:00:00.000Z", timezone: "America/Lima" },
      },
    });

    render(<KoriChatDock />);
    fireEvent.click(screen.getByText("¿Cuántos clientes necesitan respuesta?"));

    await waitFor(() => expect(screen.getByText("Respuesta.")).toBeInTheDocument());
    expect(screen.getByText("¿Y el mes pasado?")).toBeInTheDocument();
    expect(screen.queryByText("¿Qué vehículo se pregunta más esta semana?")).not.toBeInTheDocument();
  });

  it("does not submit an empty question", () => {
    render(<KoriChatDock />);

    expect(screen.getByRole("button", { name: "Enviar pregunta" })).toBeDisabled();
  });
});
