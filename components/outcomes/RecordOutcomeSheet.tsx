"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { TextField, TextAreaField } from "@/components/ui/Field";
import { LOST_REASONS, LOST_REASON_LABELS, type ConversationOutcomeType, type LostReason } from "@/lib/validations/outcome";
import { recordConversationOutcomeAction } from "@/server/actions/outcomes";

const OUTCOME_CHOICES: { value: ConversationOutcomeType | "PENDING"; icon: string; label: string; tone: string }[] = [
  { value: "SALE_CLOSED", icon: "✅", label: "Venta realizada", tone: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  { value: "SALE_LOST", icon: "❌", label: "Venta perdida", tone: "bg-red-50 text-red-800 border-red-200" },
  { value: "PENDING", icon: "⏳", label: "Seguimiento pendiente", tone: "bg-neutral-50 text-neutral-700 border-neutral-200" },
  { value: "NOT_AN_OPPORTUNITY", icon: "🚫", label: "No era oportunidad", tone: "bg-neutral-50 text-neutral-500 border-neutral-200" },
];

type ViewState = { kind: "CLOSED" } | { kind: "CHOOSING" } | { kind: "DETAILS"; outcomeType: ConversationOutcomeType } | { kind: "DONE" };

export function RecordOutcomeSheet({ conversationId, suggestedProduct }: { conversationId: string; suggestedProduct: string | null }) {
  const [view, setView] = useState<ViewState>({ kind: "CLOSED" });
  const [lostReason, setLostReason] = useState<LostReason | null>(null);
  const [productSold, setProductSold] = useState(suggestedProduct ?? "");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function reset() {
    setView({ kind: "CLOSED" });
    setLostReason(null);
    setProductSold(suggestedProduct ?? "");
    setNotes("");
    setError(null);
  }

  function choose(value: (typeof OUTCOME_CHOICES)[number]["value"]) {
    if (value === "PENDING") {
      reset();
      return;
    }
    setError(null);
    setView({ kind: "DETAILS", outcomeType: value });
  }

  function submit(outcomeType: ConversationOutcomeType) {
    if (outcomeType === "SALE_LOST" && !lostReason) {
      setError("Selecciona por qué se perdió la venta.");
      return;
    }
    setError(null);

    startTransition(async () => {
      const result = await recordConversationOutcomeAction({
        conversationId,
        outcomeType,
        lostReason: outcomeType === "SALE_LOST" ? lostReason : undefined,
        productSold: outcomeType === "SALE_CLOSED" && productSold.trim() ? productSold.trim() : undefined,
        notes: notes.trim() || undefined,
      });

      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      setView({ kind: "DONE" });
      router.refresh();
    });
  }

  if (view.kind === "CLOSED") {
    return (
      <button
        type="button"
        onClick={() => setView({ kind: "CHOOSING" })}
        className="w-full rounded-xl border border-neutral-300 px-4 py-2.5 text-center text-sm font-medium text-neutral-700"
      >
        Marcar resultado
      </button>
    );
  }

  if (view.kind === "DONE") {
    return (
      <Card className="text-center text-sm text-neutral-600">
        Resultado guardado.{" "}
        <button type="button" onClick={reset} className="font-medium text-neutral-900 underline">
          Marcar otro
        </button>
      </Card>
    );
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-neutral-900">Marcar resultado</p>
        <button type="button" onClick={reset} className="text-sm text-neutral-400">
          Cancelar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {OUTCOME_CHOICES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            disabled={isPending}
            onClick={() => choose(choice.value)}
            className={`rounded-xl border px-3 py-2.5 text-left text-sm font-medium disabled:opacity-50 ${choice.tone} ${
              view.kind === "DETAILS" && view.outcomeType === choice.value ? "ring-2 ring-neutral-900" : ""
            }`}
          >
            {choice.icon} {choice.label}
          </button>
        ))}
      </div>

      {view.kind === "DETAILS" && view.outcomeType === "SALE_LOST" && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-neutral-700">¿Por qué se perdió?</p>
          <div className="flex flex-wrap gap-1.5">
            {LOST_REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                onClick={() => setLostReason(reason)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  lostReason === reason ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-600"
                }`}
              >
                {LOST_REASON_LABELS[reason]}
              </button>
            ))}
          </div>
        </div>
      )}

      {view.kind === "DETAILS" && view.outcomeType === "SALE_CLOSED" && (
        <TextField
          label="Producto (opcional)"
          id="outcome-product-sold"
          value={productSold}
          onChange={(e) => setProductSold(e.target.value)}
        />
      )}

      {view.kind === "DETAILS" && (
        <TextAreaField label="Nota (opcional)" id="outcome-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      )}

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {view.kind === "DETAILS" && (
        <Button type="button" disabled={isPending} onClick={() => submit(view.outcomeType)}>
          {isPending ? "Guardando…" : "Guardar"}
        </Button>
      )}
    </Card>
  );
}
