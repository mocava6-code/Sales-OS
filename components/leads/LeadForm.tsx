"use client";

import { useActionState } from "react";
import { TextField, SelectField } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { createLeadAction, type LeadFormState } from "@/server/actions/leads";

export function LeadForm() {
  const [state, action] = useActionState<LeadFormState, FormData>(createLeadAction, undefined);

  return (
    <form action={action} className="space-y-4">
      <TextField
        label="Nombre"
        id="name"
        required
        placeholder="Nombre del cliente"
        error={state?.errors?.name?.[0]}
      />
      <TextField
        label="Número de WhatsApp"
        id="phone"
        required
        placeholder="+51 999 999 999"
        error={state?.errors?.phone?.[0]}
      />
      <SelectField label="Prioridad" id="priority" defaultValue="NORMAL">
        <option value="NORMAL">Normal</option>
        <option value="HIGH">Alta</option>
      </SelectField>
      <SubmitButton pendingText="Guardando…">Guardar cliente</SubmitButton>
    </form>
  );
}
