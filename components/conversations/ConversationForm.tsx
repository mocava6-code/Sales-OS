"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { logConversationAction, type ConversationFormState } from "@/server/actions/conversations";

let nextRowId = 1;

export function ConversationForm({ leadId }: { leadId: string }) {
  const [state, action] = useActionState<ConversationFormState, FormData>(
    logConversationAction,
    undefined,
  );
  const [rowIds, setRowIds] = useState<number[]>([0]);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="leadId" value={leadId} />

      <div className="space-y-3">
        {rowIds.map((rowId, index) => (
          <div key={rowId} className="rounded-xl border border-neutral-200 p-3">
            <div className="flex items-center justify-between">
              <select
                name="direction"
                defaultValue={index % 2 === 0 ? "INBOUND" : "OUTBOUND"}
                className="rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              >
                <option value="INBOUND">Dijo el cliente</option>
                <option value="OUTBOUND">Dijiste tú</option>
              </select>
              {rowIds.length > 1 && (
                <button
                  type="button"
                  onClick={() => setRowIds((ids) => ids.filter((id) => id !== rowId))}
                  className="text-sm text-neutral-400"
                >
                  Quitar
                </button>
              )}
            </div>
            <textarea
              name="content"
              rows={3}
              placeholder="Pega o escribe el mensaje…"
              className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-base focus:border-neutral-900 focus:outline-none"
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setRowIds((ids) => [...ids, nextRowId++])}
        className="text-sm font-medium text-neutral-700 underline"
      >
        Agregar otro mensaje
      </button>

      <SubmitButton pendingText="Guardando…">Guardar conversación</SubmitButton>
      {state?.formError && <p className="text-sm text-red-600">{state.formError}</p>}
    </form>
  );
}
