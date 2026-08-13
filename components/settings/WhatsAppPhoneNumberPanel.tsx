"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextField } from "@/components/ui/Field";
import { registerWhatsAppPhoneNumberAction } from "@/server/actions/whatsapp";

const EMPTY_FORM = { phoneNumberId: "", displayPhoneNumber: "", wabaId: "", label: "" };

export function WhatsAppPhoneNumberPanel() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleRegister() {
    setError(null);
    startTransition(async () => {
      const result = await registerWhatsAppPhoneNumberAction({
        phoneNumberId: form.phoneNumberId,
        displayPhoneNumber: form.displayPhoneNumber,
        wabaId: form.wabaId,
        label: form.label || undefined,
      });

      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      setForm(EMPTY_FORM);
      router.refresh();
    });
  }

  return (
    <Card className="space-y-3">
      <p className="font-medium text-neutral-900">Registrar un número de WhatsApp</p>
      <p className="text-sm text-neutral-500">
        Cópialos exactamente desde el WhatsApp Manager de Meta — los mensajes entrantes solo crean clientes para los números
        registrados aquí.
      </p>

      <TextField
        label="phone_number_id"
        id="phoneNumberId"
        value={form.phoneNumberId}
        onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })}
        inputMode="numeric"
      />
      <TextField
        label="Número de teléfono a mostrar"
        id="displayPhoneNumber"
        value={form.displayPhoneNumber}
        onChange={(e) => setForm({ ...form, displayPhoneNumber: e.target.value })}
        placeholder="+51 999 999 999"
      />
      <TextField
        label="Id de la cuenta de WhatsApp Business (waba_id)"
        id="wabaId"
        value={form.wabaId}
        onChange={(e) => setForm({ ...form, wabaId: e.target.value })}
        inputMode="numeric"
      />
      <TextField
        label="Etiqueta (opcional)"
        id="label"
        value={form.label}
        onChange={(e) => setForm({ ...form, label: e.target.value })}
      />

      <Button type="button" disabled={isPending} onClick={handleRegister}>
        {isPending ? "Registrando…" : "Registrar número"}
      </Button>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
