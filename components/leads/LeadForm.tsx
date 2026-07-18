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
        label="Name"
        id="name"
        required
        placeholder="Customer name"
        error={state?.errors?.name?.[0]}
      />
      <TextField
        label="WhatsApp number"
        id="phone"
        required
        placeholder="+52 1 55 1234 5678"
        error={state?.errors?.phone?.[0]}
      />
      <SelectField label="Priority" id="priority" defaultValue="NORMAL">
        <option value="NORMAL">Normal</option>
        <option value="HIGH">High</option>
      </SelectField>
      <SubmitButton pendingText="Saving…">Save lead</SubmitButton>
    </form>
  );
}
