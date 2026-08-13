"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import {
  importHistoricalWhatsAppChatAction,
  previewHistoricalImportFromTextAction,
  previewHistoricalImportFromUploadAction,
} from "@/server/actions/whatsapp";

type DateOrder = "DMY" | "MDY";

interface ReadyPreview {
  rawText: string;
  dateOrder: DateOrder;
  timezone: string;
  manualBusinessSenderLabel?: string;
  participantLabels: string[];
  suggestedCustomerPhone: string | null;
  messageCount: number;
  unparseableTimestampCount: number;
}

interface ImportSummary {
  createdCount: number;
  duplicateCount: number;
  skippedUnparseableTimestampCount: number;
  conversationCreated: boolean;
  analysisTriggered: boolean;
}

type ViewState =
  | { kind: "IDLE" }
  | { kind: "NEEDS_RESOLUTION"; candidateLabels: [string, string]; rawText: string; dateOrder: DateOrder; timezone: string }
  | { kind: "NEEDS_RESOLUTION_FROM_UPLOAD" }
  | { kind: "READY_TO_IMPORT"; preview: ReadyPreview }
  | { kind: "COMPLETED"; summary: ImportSummary }
  | { kind: "ERROR"; message: string };

export function WhatsAppHistoryImportPanel({ defaultTimezone }: { defaultTimezone: string }) {
  const [pastedText, setPastedText] = useState("");
  const [dateOrder, setDateOrder] = useState<DateOrder>("DMY");
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [phone, setPhone] = useState("");
  const [runAnalysis, setRunAnalysis] = useState(false);
  const [view, setView] = useState<ViewState>({ kind: "IDLE" });
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function applyPreviewResult(result: Awaited<ReturnType<typeof previewHistoricalImportFromTextAction>>, source: "PASTE" | "UPLOAD") {
    if (!result.ok) {
      setView({ kind: "ERROR", message: result.error.message });
      return;
    }
    if (result.data.status === "NEEDS_PARTICIPANT_RESOLUTION") {
      // Uploaded raw bytes aren't retained client-side (same v1
      // simplification as components/knowledge/ImportConversationPanel.tsx)
      // — an ambiguous upload can't be resubmitted with the resolution
      // answer, so ask the OWNER to use Paste instead, where the text is
      // already in local state.
      if (source === "UPLOAD") {
        setView({ kind: "NEEDS_RESOLUTION_FROM_UPLOAD" });
        return;
      }
      setView({ kind: "NEEDS_RESOLUTION", candidateLabels: result.data.candidateLabels, rawText: pastedText, dateOrder, timezone });
      return;
    }
    setView({ kind: "READY_TO_IMPORT", preview: result.data });
    setPhone(result.data.suggestedCustomerPhone ?? "");
  }

  function handlePastePreview() {
    if (pastedText.trim().length === 0) return;
    startTransition(async () => {
      const result = await previewHistoricalImportFromTextAction({ rawText: pastedText, dateOrder, timezone });
      applyPreviewResult(result, "PASTE");
    });
  }

  function handleUploadPreview() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("dateOrder", dateOrder);
      formData.set("timezone", timezone);
      const result = await previewHistoricalImportFromUploadAction(formData);
      applyPreviewResult(result, "UPLOAD");
    });
  }

  function handleResolve(label: string) {
    if (view.kind !== "NEEDS_RESOLUTION") return;
    const { rawText, dateOrder: resolvedDateOrder, timezone: resolvedTimezone } = view;
    startTransition(async () => {
      const result = await previewHistoricalImportFromTextAction({
        rawText,
        dateOrder: resolvedDateOrder,
        timezone: resolvedTimezone,
        manualBusinessSenderLabel: label,
      });
      applyPreviewResult(result, "PASTE");
    });
  }

  function handleImport() {
    if (view.kind !== "READY_TO_IMPORT") return;
    if (phone.trim().length === 0) return;
    const { preview } = view;
    startTransition(async () => {
      const result = await importHistoricalWhatsAppChatAction({
        rawText: preview.rawText,
        dateOrder: preview.dateOrder,
        timezone: preview.timezone,
        manualBusinessSenderLabel: preview.manualBusinessSenderLabel,
        phone,
        runAnalysis,
      });
      if (!result.ok) {
        setView({ kind: "ERROR", message: result.error.message });
        return;
      }
      setView({ kind: "COMPLETED", summary: result.data });
    });
  }

  function reset() {
    setPastedText("");
    setPhone("");
    setRunAnalysis(false);
    setView({ kind: "IDLE" });
  }

  if (view.kind === "NEEDS_RESOLUTION" || view.kind === "NEEDS_RESOLUTION_FROM_UPLOAD") {
    return (
      <Card className="space-y-3">
        <p className="font-medium text-neutral-900">¿Cuál participante es el negocio?</p>
        {view.kind === "NEEDS_RESOLUTION_FROM_UPLOAD" ? (
          <p className="text-sm text-neutral-500">
            Esta exportación tiene un remitente ambiguo. Vuelve a subirla como texto pegado (copia el texto del chat en el
            cuadro de abajo) para poder preguntar cuál participante es el negocio.
          </p>
        ) : (
          <>
            <p className="text-sm text-neutral-500">Esto es solo para identificar quién es quién — no es una carga manual de datos.</p>
            <div className="flex gap-2">
              {view.candidateLabels.map((label) => (
                <Button key={label} type="button" variant="secondary" disabled={isPending} onClick={() => handleResolve(label)}>
                  {label}
                </Button>
              ))}
            </div>
          </>
        )}
        <Button type="button" variant="secondary" onClick={reset}>
          Cancelar
        </Button>
      </Card>
    );
  }

  if (view.kind === "READY_TO_IMPORT") {
    const { preview } = view;
    return (
      <Card className="space-y-3">
        <p className="font-medium text-neutral-900">Listo para importar</p>
        <p className="text-sm text-neutral-500">
          Se encontraron {preview.messageCount} mensaje{preview.messageCount === 1 ? "" : "s"}
          {preview.unparseableTimestampCount > 0 && (
            <span className="text-red-600"> · se omitirán {preview.unparseableTimestampCount} (fecha/hora ilegible)</span>
          )}
        </p>
        <TextField
          label="Número de teléfono del cliente"
          id="historical-import-phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+51 999 999 999"
        />
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-neutral-300"
            checked={runAnalysis}
            onChange={(e) => setRunAnalysis(e.target.checked)}
          />
          Ejecutar el análisis de Kori después de importar
        </label>
        <div className="flex gap-2">
          <Button type="button" disabled={isPending || phone.trim().length === 0} onClick={handleImport}>
            {isPending ? "Importando…" : "Importar"}
          </Button>
          <Button type="button" variant="secondary" disabled={isPending} onClick={reset}>
            Cancelar
          </Button>
        </div>
      </Card>
    );
  }

  if (view.kind === "COMPLETED") {
    const { summary } = view;
    return (
      <Card className="space-y-1">
        <p className="text-sm text-neutral-900">Se importaron {summary.createdCount} mensaje{summary.createdCount === 1 ? "" : "s"}</p>
        {summary.duplicateCount > 0 && (
          <p className="text-sm text-neutral-500">{summary.duplicateCount} ya estaban importados — se omitieron</p>
        )}
        {summary.skippedUnparseableTimestampCount > 0 && (
          <p className="text-sm text-neutral-500">Se omitieron {summary.skippedUnparseableTimestampCount} — fecha/hora ilegible</p>
        )}
        <p className="text-sm text-neutral-500">{summary.conversationCreated ? "Se creó una conversación nueva" : "Se combinó con una conversación existente"}</p>
        {summary.analysisTriggered && <p className="text-sm text-neutral-500">El análisis de Kori se ejecutó sobre la conversación reconstruida</p>}
        <Button type="button" variant="secondary" className="mt-2" onClick={reset}>
          Importar otra
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <p className="font-medium text-neutral-900">Exportación del chat</p>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Orden de la fecha" id="historical-import-date-order" value={dateOrder} onChange={(e) => setDateOrder(e.target.value as DateOrder)}>
            <option value="DMY">Día/Mes/Año</option>
            <option value="MDY">Mes/Día/Año</option>
          </SelectField>
          <TextField label="Zona horaria" id="historical-import-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </div>
      </Card>

      <Card className="space-y-3">
        <p className="font-medium text-neutral-900">Subir exportación de WhatsApp</p>
        <input ref={fileInputRef} type="file" accept=".txt,.zip" className="block w-full text-sm" />
        <Button type="button" disabled={isPending} onClick={handleUploadPreview}>
          {isPending ? "Leyendo…" : "Vista previa"}
        </Button>
      </Card>

      <Card className="space-y-3">
        <p className="font-medium text-neutral-900">Pegar conversación</p>
        <TextAreaField
          label="Texto de la conversación"
          id="historical-import-pasted-text"
          rows={8}
          value={pastedText}
          onChange={(e) => setPastedText(e.target.value)}
          placeholder="27/07/26, 14:05 - Juan Pérez: Hola…"
        />
        <Button type="button" disabled={isPending || pastedText.trim().length === 0} onClick={handlePastePreview}>
          {isPending ? "Leyendo…" : "Vista previa"}
        </Button>
      </Card>

      {view.kind === "ERROR" && (
        <p className="text-sm text-red-600" role="alert">
          {view.message}
        </p>
      )}
    </div>
  );
}
