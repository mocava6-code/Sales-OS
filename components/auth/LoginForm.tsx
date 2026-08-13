"use client";

import { useActionState } from "react";
import { TextField } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { requestMagicLink, type LoginState } from "@/app/(auth)/login/actions";

export function LoginForm() {
  const [state, action] = useActionState<LoginState, FormData>(requestMagicLink, undefined);

  return (
    <form action={action} className="space-y-4">
      <TextField
        label="Correo electrónico"
        id="email"
        type="email"
        autoComplete="email"
        required
        placeholder="tu@negocio.com"
      />
      <SubmitButton pendingText="Enviando…">Enviar enlace de acceso</SubmitButton>
      {state?.message && <p className="text-sm text-neutral-600">{state.message}</p>}
    </form>
  );
}
