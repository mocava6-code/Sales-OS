// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionDraftReply } from "../DecisionDraftReply";

vi.mock("@/server/actions/whatsapp", () => ({
  queueWhatsAppReplyAction: vi.fn(),
  approveWhatsAppReplyAction: vi.fn(),
  rejectWhatsAppReplyAction: vi.fn(),
  sendQueuedReplyAction: vi.fn(),
}));

import {
  approveWhatsAppReplyAction,
  queueWhatsAppReplyAction,
  rejectWhatsAppReplyAction,
  sendQueuedReplyAction,
} from "@/server/actions/whatsapp";
import type { PendingWhatsAppMessageSummaryDTO } from "@/server/application/dto";

function pendingMessage(overrides: Partial<PendingWhatsAppMessageSummaryDTO> = {}): PendingWhatsAppMessageSummaryDTO {
  return {
    id: "pending-1",
    conversationId: "conv-1",
    toPhoneNumber: "+51999999999",
    body: "Hola! Sí tenemos el kit disponible.",
    status: "WAITING_APPROVAL",
    decisionRecordId: "decision-1",
    externalId: null,
    failureReason: null,
    createdAt: new Date("2026-08-18T10:00:00.000Z"),
    sentAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(queueWhatsAppReplyAction).mockReset();
  vi.mocked(approveWhatsAppReplyAction).mockReset();
  vi.mocked(rejectWhatsAppReplyAction).mockReset();
  vi.mocked(sendQueuedReplyAction).mockReset();
});

describe("DecisionDraftReply", () => {
  it("shows the draft text pre-filled, editable, before queueing", () => {
    render(<DecisionDraftReply decisionRecordId="decision-1" conversationId="conv-1" draftText="Sí, tenemos stock." />);

    expect(screen.getByRole("textbox")).toHaveValue("Sí, tenemos stock.");
    expect(screen.getByRole("button", { name: /Encolar como respuesta/ })).toBeInTheDocument();
  });

  it("queues the (possibly edited) draft with the decisionRecordId attached, then shows WAITING_APPROVAL actions", async () => {
    vi.mocked(queueWhatsAppReplyAction).mockResolvedValue({ ok: true, data: pendingMessage() });

    render(<DecisionDraftReply decisionRecordId="decision-1" conversationId="conv-1" draftText="Sí, tenemos stock." />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Sí, tenemos stock disponible ahora." } });
    fireEvent.click(screen.getByRole("button", { name: /Encolar como respuesta/ }));

    await waitFor(() => {
      expect(queueWhatsAppReplyAction).toHaveBeenCalledWith({
        conversationId: "conv-1",
        body: "Sí, tenemos stock disponible ahora.",
        decisionRecordId: "decision-1",
      });
    });

    expect(await screen.findByText("Esperando tu aprobación")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprobar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeInTheDocument();
  });

  it("approve transitions to READY and shows the send button", async () => {
    vi.mocked(queueWhatsAppReplyAction).mockResolvedValue({ ok: true, data: pendingMessage() });
    vi.mocked(approveWhatsAppReplyAction).mockResolvedValue({ ok: true, data: pendingMessage({ status: "READY" }) });

    render(<DecisionDraftReply decisionRecordId="decision-1" conversationId="conv-1" draftText="Sí, tenemos stock." />);
    fireEvent.click(screen.getByRole("button", { name: /Encolar como respuesta/ }));
    await screen.findByRole("button", { name: "Aprobar" });

    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }));

    expect(await screen.findByText("Lista para enviar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enviar por WhatsApp/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aprobar" })).not.toBeInTheDocument();
  });

  it("send transitions to SENT and shows no further actions", async () => {
    vi.mocked(queueWhatsAppReplyAction).mockResolvedValue({ ok: true, data: pendingMessage() });
    vi.mocked(approveWhatsAppReplyAction).mockResolvedValue({ ok: true, data: pendingMessage({ status: "READY" }) });
    vi.mocked(sendQueuedReplyAction).mockResolvedValue({ ok: true, data: pendingMessage({ status: "SENT", sentAt: new Date() }) });

    render(<DecisionDraftReply decisionRecordId="decision-1" conversationId="conv-1" draftText="Sí, tenemos stock." />);
    fireEvent.click(screen.getByRole("button", { name: /Encolar como respuesta/ }));
    await screen.findByRole("button", { name: "Aprobar" });
    fireEvent.click(screen.getByRole("button", { name: "Aprobar" }));
    await screen.findByRole("button", { name: /Enviar por WhatsApp/ });

    fireEvent.click(screen.getByRole("button", { name: /Enviar por WhatsApp/ }));

    expect(await screen.findByText("Enviada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enviar por WhatsApp/ })).not.toBeInTheDocument();
  });

  it("reject transitions to CANCELLED and shows no further actions", async () => {
    vi.mocked(queueWhatsAppReplyAction).mockResolvedValue({ ok: true, data: pendingMessage() });
    vi.mocked(rejectWhatsAppReplyAction).mockResolvedValue({ ok: true, data: pendingMessage({ status: "CANCELLED" }) });

    render(<DecisionDraftReply decisionRecordId="decision-1" conversationId="conv-1" draftText="Sí, tenemos stock." />);
    fireEvent.click(screen.getByRole("button", { name: /Encolar como respuesta/ }));
    await screen.findByRole("button", { name: "Rechazar" });

    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));

    expect(await screen.findByText("Rechazada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aprobar" })).not.toBeInTheDocument();
  });

  it("shows an inline error and stays on the draft when queueing fails", async () => {
    vi.mocked(queueWhatsAppReplyAction).mockResolvedValue({
      ok: false,
      error: { code: "INVALID_INPUT", message: "Esta conversación no tiene un número de WhatsApp asociado." },
    });

    render(<DecisionDraftReply decisionRecordId="decision-1" conversationId="conv-1" draftText="Sí, tenemos stock." />);
    fireEvent.click(screen.getByRole("button", { name: /Encolar como respuesta/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Esta conversación no tiene un número de WhatsApp asociado.");
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});
