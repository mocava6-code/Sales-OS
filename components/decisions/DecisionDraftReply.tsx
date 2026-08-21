"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { TextAreaField } from "@/components/ui/Field";
import { PENDING_WHATSAPP_MESSAGE_STATUS_LABELS } from "@/lib/copy/labels";
import { approveWhatsAppReplyAction, queueWhatsAppReplyAction, rejectWhatsAppReplyAction, sendQueuedReplyAction } from "@/server/actions/whatsapp";
import type { PendingWhatsAppMessageSummaryDTO } from "@/server/application/dto";

/**
 * Closes the loop the schema already anticipated:
 * PendingWhatsAppMessage.decisionRecordId exists specifically "for when this
 * reply originated from a Kori recommendation the advisor approved" — but
 * nothing ever set it, because no UI ever queued a decision's draft at all.
 * This is the first caller of queueWhatsAppReplyAction/approve/reject/send
 * in the whole product; those actions already existed and already worked.
 */
export function DecisionDraftReply({ decisionRecordId, conversationId, draftText }: { decisionRecordId: string; conversationId: string; draftText: string }) {
  const [body, setBody] = useState(draftText);
  const [message, setMessage] = useState<PendingWhatsAppMessageSummaryDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function queue() {
    setError(null);
    startTransition(async () => {
      const result = await queueWhatsAppReplyAction({ conversationId, body, decisionRecordId });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setMessage(result.data);
    });
  }

  function approve() {
    if (!message) return;
    setError(null);
    startTransition(async () => {
      const result = await approveWhatsAppReplyAction({ pendingMessageId: message.id });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setMessage(result.data);
    });
  }

  function reject() {
    if (!message) return;
    setError(null);
    startTransition(async () => {
      const result = await rejectWhatsAppReplyAction({ pendingMessageId: message.id });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setMessage(result.data);
    });
  }

  function send() {
    if (!message) return;
    setError(null);
    startTransition(async () => {
      const result = await sendQueuedReplyAction({ pendingMessageId: message.id });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setMessage(result.data);
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-neutral-200 p-4" data-testid="decision-draft-reply">
      <h3 className="text-sm font-medium text-neutral-500">Respuesta sugerida por Kori</h3>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {!message && (
        <>
          <TextAreaField label="Mensaje" id="draft-reply-body" value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
          <Button type="button" variant="primary" disabled={isPending || body.trim().length === 0} onClick={queue}>
            {isPending ? "Encolando…" : "Encolar como respuesta de WhatsApp"}
          </Button>
        </>
      )}

      {message && (
        <div className="space-y-2">
          <p className="whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-sm text-neutral-800">{message.body}</p>
          <p className="text-xs font-medium text-neutral-500">{PENDING_WHATSAPP_MESSAGE_STATUS_LABELS[message.status]}</p>
          <div className="flex gap-2">
            {message.status === "WAITING_APPROVAL" && (
              <>
                <Button type="button" variant="primary" disabled={isPending} onClick={approve}>
                  Aprobar
                </Button>
                <Button type="button" variant="danger" disabled={isPending} onClick={reject}>
                  Rechazar
                </Button>
              </>
            )}
            {message.status === "READY" && (
              <Button type="button" variant="primary" disabled={isPending} onClick={send}>
                {isPending ? "Enviando…" : "Enviar por WhatsApp"}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
