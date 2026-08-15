"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { analyzeConversationAction } from "@/server/actions/decisions";

export function AnalyzeConversationButton({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    setSuccessMessage(null);
    startTransition(async () => {
      const result = await analyzeConversationAction({ conversationId });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setSuccessMessage(
        result.data.decisions.length === 1
          ? "Análisis completado — 1 decisión generada."
          : `Análisis completado — ${result.data.decisions.length} decisiones generadas.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {successMessage && <p className="text-sm text-green-700">{successMessage}</p>}
      <Button type="button" variant="secondary" disabled={isPending} onClick={handleClick}>
        {isPending ? "Analizando…" : "Analizar conversación"}
      </Button>
    </div>
  );
}
