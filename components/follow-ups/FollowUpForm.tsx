"use client";

import { useActionState } from "react";
import { TextField, TextAreaField } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { createFollowUpAction, type FollowUpFormState } from "@/server/actions/follow-ups";

export function FollowUpForm({ leadId }: { leadId: string }) {
  const [state, action] = useActionState<FollowUpFormState, FormData>(
    createFollowUpAction,
    undefined,
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="leadId" value={leadId} />
      <TextField
        label="Fecha de vencimiento"
        id="dueAt"
        type="date"
        required
        error={state?.errors?.dueAt?.[0]}
      />
      <TextAreaField label="Nota (opcional)" id="note" placeholder="¿De qué se trata el seguimiento?" />
      <SubmitButton pendingText="Guardando…">Guardar seguimiento</SubmitButton>
      {state?.formError && <p className="text-sm text-red-600">{state.formError}</p>}
    </form>
  );
}
