// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecordOutcomeSheet } from "../RecordOutcomeSheet";

vi.mock("@/server/actions/outcomes", () => ({
  recordConversationOutcomeAction: vi.fn(),
  suggestConversationOutcomeAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { recordConversationOutcomeAction, suggestConversationOutcomeAction } from "@/server/actions/outcomes";

beforeEach(() => {
  vi.mocked(suggestConversationOutcomeAction).mockReset();
  // Default: no suggestion — most tests don't care about Fase C at all, and
  // this keeps the existing manual-flow assertions unaffected by it.
  vi.mocked(suggestConversationOutcomeAction).mockResolvedValue({ ok: true, data: null });
});

function fakeSuccess(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true as const,
    data: {
      id: "outcome-1",
      conversationId: "conv-1",
      outcomeType: "SALE_CLOSED",
      lostReason: null,
      productSold: null,
      notes: null,
      occurredAt: new Date("2026-08-13T10:00:00.000Z"),
      ...overrides,
    },
  };
}

describe("RecordOutcomeSheet", () => {
  it("starts closed, showing only the trigger button", () => {
    render(<RecordOutcomeSheet conversationId="conv-1" suggestedProduct={null} />);

    expect(screen.getByRole("button", { name: "Marcar resultado" })).toBeInTheDocument();
    expect(screen.queryByText("✅ Venta realizada")).not.toBeInTheDocument();
  });

  it("opens the four outcome choices when the trigger is clicked", () => {
    render(<RecordOutcomeSheet conversationId="conv-1" suggestedProduct={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Marcar resultado" }));

    expect(screen.getByText("✅ Venta realizada")).toBeInTheDocument();
    expect(screen.getByText("❌ Venta perdida")).toBeInTheDocument();
    expect(screen.getByText("⏳ Seguimiento pendiente")).toBeInTheDocument();
    expect(screen.getByText("🚫 No era oportunidad")).toBeInTheDocument();
  });

  it("choosing 'Seguimiento pendiente' closes the sheet without calling the action", () => {
    render(<RecordOutcomeSheet conversationId="conv-1" suggestedProduct={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Marcar resultado" }));
    fireEvent.click(screen.getByText("⏳ Seguimiento pendiente"));

    expect(screen.getByRole("button", { name: "Marcar resultado" })).toBeInTheDocument();
    expect(recordConversationOutcomeAction).not.toHaveBeenCalled();
  });

  it("requires a lost reason before submitting a lost sale", () => {
    render(<RecordOutcomeSheet conversationId="conv-1" suggestedProduct={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Marcar resultado" }));
    fireEvent.click(screen.getByText("❌ Venta perdida"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(screen.getByText("Selecciona por qué se perdió la venta.")).toBeInTheDocument();
    expect(recordConversationOutcomeAction).not.toHaveBeenCalled();
  });

  it("submits a lost sale with the selected reason", async () => {
    vi.mocked(recordConversationOutcomeAction).mockResolvedValue(fakeSuccess({ outcomeType: "SALE_LOST", lostReason: "PRECIO" }));

    render(<RecordOutcomeSheet conversationId="conv-1" suggestedProduct={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Marcar resultado" }));
    fireEvent.click(screen.getByText("❌ Venta perdida"));
    fireEvent.click(screen.getByText("Precio"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("Resultado guardado.")).toBeInTheDocument());
    expect(recordConversationOutcomeAction).toHaveBeenCalledWith({
      conversationId: "conv-1",
      outcomeType: "SALE_LOST",
      lostReason: "PRECIO",
      productSold: undefined,
      notes: undefined,
    });
  });

  it("submits a closed sale with no lost reason required, prefilling the suggested product", async () => {
    vi.mocked(recordConversationOutcomeAction).mockResolvedValue(fakeSuccess());

    render(<RecordOutcomeSheet conversationId="conv-1" suggestedProduct="Hilux TRAVO" />);

    fireEvent.click(screen.getByRole("button", { name: "Marcar resultado" }));
    fireEvent.click(screen.getByText("✅ Venta realizada"));

    expect(screen.getByLabelText("Producto (opcional)")).toHaveValue("Hilux TRAVO");

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("Resultado guardado.")).toBeInTheDocument());
    expect(recordConversationOutcomeAction).toHaveBeenCalledWith({
      conversationId: "conv-1",
      outcomeType: "SALE_CLOSED",
      lostReason: undefined,
      productSold: "Hilux TRAVO",
      notes: undefined,
    });
  });

  it("shows the server error message and stays open when the action fails", async () => {
    vi.mocked(recordConversationOutcomeAction).mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "No encontramos esa conversación." },
    });

    render(<RecordOutcomeSheet conversationId="conv-1" suggestedProduct={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Marcar resultado" }));
    fireEvent.click(screen.getByText("🚫 No era oportunidad"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("No encontramos esa conversación.")).toBeInTheDocument());
    expect(screen.queryByText("Resultado guardado.")).not.toBeInTheDocument();
  });

  it("lets the user cancel back to the closed trigger state", () => {
    render(<RecordOutcomeSheet conversationId="conv-1" suggestedProduct={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Marcar resultado" }));
    fireEvent.click(screen.getByText("Cancelar"));

    expect(screen.getByRole("button", { name: "Marcar resultado" })).toBeInTheDocument();
  });

  it("does not fetch a suggestion until the sheet is opened", () => {
    render(<RecordOutcomeSheet conversationId="conv-1" suggestedProduct={null} />);
    expect(suggestConversationOutcomeAction).not.toHaveBeenCalled();
  });

  it("fetches a suggestion for this conversation when the sheet opens, and shows it once resolved", async () => {
    vi.mocked(suggestConversationOutcomeAction).mockResolvedValue({
      ok: true,
      data: { suggestedOutcomeType: "SALE_LOST", suggestedLostReason: "PRECIO", reasoning: "El cliente preguntó el precio y no volvió a responder." },
    });

    render(<RecordOutcomeSheet conversationId="conv-1" suggestedProduct={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Marcar resultado" }));

    expect(suggestConversationOutcomeAction).toHaveBeenCalledWith({ conversationId: "conv-1" });
    await waitFor(() => expect(screen.getByText(/Kori sugiere: Venta perdida/)).toBeInTheDocument());
    expect(screen.getByText(/El cliente preguntó el precio y no volvió a responder\./)).toBeInTheDocument();
  });

  it("shows nothing extra when the suggestion is null (AI unavailable or no opinion) — identical to the baseline flow", async () => {
    render(<RecordOutcomeSheet conversationId="conv-1" suggestedProduct={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Marcar resultado" }));

    await waitFor(() => expect(suggestConversationOutcomeAction).toHaveBeenCalled());
    expect(screen.queryByText(/Kori sugiere/)).not.toBeInTheDocument();
  });

  it("pre-selects the suggested lost reason chip, but still requires the advisor to confirm by tapping Guardar", async () => {
    vi.mocked(suggestConversationOutcomeAction).mockResolvedValue({
      ok: true,
      data: { suggestedOutcomeType: "SALE_LOST", suggestedLostReason: "TIEMPO_DE_ESPERA", reasoning: "Se cansó de esperar la cotización." },
    });
    vi.mocked(recordConversationOutcomeAction).mockReset();
    vi.mocked(recordConversationOutcomeAction).mockResolvedValue(fakeSuccess({ outcomeType: "SALE_LOST", lostReason: "TIEMPO_DE_ESPERA" }));

    render(<RecordOutcomeSheet conversationId="conv-1" suggestedProduct={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Marcar resultado" }));
    await waitFor(() => expect(screen.getByText(/Kori sugiere: Venta perdida/)).toBeInTheDocument());

    fireEvent.click(screen.getByText("❌ Venta perdida"));

    expect(screen.getByText("Tiempo de espera")).toHaveClass("bg-neutral-900");
    expect(screen.getByText("Kori sugirió este motivo — puedes cambiarlo.")).toBeInTheDocument();
    expect(recordConversationOutcomeAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.getByText("Resultado guardado.")).toBeInTheDocument());
    expect(recordConversationOutcomeAction).toHaveBeenCalledWith({
      conversationId: "conv-1",
      outcomeType: "SALE_LOST",
      lostReason: "TIEMPO_DE_ESPERA",
      productSold: undefined,
      notes: undefined,
    });
  });

  it("lets the advisor pick a different lost reason than the one Kori suggested", async () => {
    vi.mocked(suggestConversationOutcomeAction).mockResolvedValue({
      ok: true,
      data: { suggestedOutcomeType: "SALE_LOST", suggestedLostReason: "PRECIO", reasoning: "Objetó el precio." },
    });

    render(<RecordOutcomeSheet conversationId="conv-1" suggestedProduct={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Marcar resultado" }));
    await waitFor(() => expect(screen.getByText(/Kori sugiere: Venta perdida/)).toBeInTheDocument());

    fireEvent.click(screen.getByText("❌ Venta perdida"));
    fireEvent.click(screen.getByText("Dejó de responder"));

    expect(screen.getByText("Dejó de responder")).toHaveClass("bg-neutral-900");
    expect(screen.getByText("Precio")).not.toHaveClass("bg-neutral-900");
  });
});
