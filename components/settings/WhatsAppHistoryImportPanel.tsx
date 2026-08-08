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
        <p className="font-medium text-neutral-900">Which participant is the business?</p>
        {view.kind === "NEEDS_RESOLUTION_FROM_UPLOAD" ? (
          <p className="text-sm text-neutral-500">
            This export has an ambiguous sender. Re-upload as a paste (copy the chat text into the box below) so we can ask
            which participant is the business.
          </p>
        ) : (
          <>
            <p className="text-sm text-neutral-500">This is metadata resolution, not manual data entry — it just tells us who&apos;s who.</p>
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
          Cancel
        </Button>
      </Card>
    );
  }

  if (view.kind === "READY_TO_IMPORT") {
    const { preview } = view;
    return (
      <Card className="space-y-3">
        <p className="font-medium text-neutral-900">Ready to import</p>
        <p className="text-sm text-neutral-500">
          {preview.messageCount} message{preview.messageCount === 1 ? "" : "s"} found
          {preview.unparseableTimestampCount > 0 && (
            <span className="text-red-600"> · {preview.unparseableTimestampCount} will be skipped (unreadable timestamp)</span>
          )}
        </p>
        <TextField
          label="Customer's phone number"
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
          Run Kori&apos;s analysis after import
        </label>
        <div className="flex gap-2">
          <Button type="button" disabled={isPending || phone.trim().length === 0} onClick={handleImport}>
            {isPending ? "Importing…" : "Import"}
          </Button>
          <Button type="button" variant="secondary" disabled={isPending} onClick={reset}>
            Cancel
          </Button>
        </div>
      </Card>
    );
  }

  if (view.kind === "COMPLETED") {
    const { summary } = view;
    return (
      <Card className="space-y-1">
        <p className="text-sm text-neutral-900">{summary.createdCount} message{summary.createdCount === 1 ? "" : "s"} imported</p>
        {summary.duplicateCount > 0 && (
          <p className="text-sm text-neutral-500">{summary.duplicateCount} already imported — skipped</p>
        )}
        {summary.skippedUnparseableTimestampCount > 0 && (
          <p className="text-sm text-neutral-500">{summary.skippedUnparseableTimestampCount} skipped — unreadable timestamp</p>
        )}
        <p className="text-sm text-neutral-500">{summary.conversationCreated ? "New conversation created" : "Merged into existing conversation"}</p>
        {summary.analysisTriggered && <p className="text-sm text-neutral-500">Kori&apos;s analysis ran on the reconstructed conversation</p>}
        <Button type="button" variant="secondary" className="mt-2" onClick={reset}>
          Import another
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <p className="font-medium text-neutral-900">Chat export</p>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Date order" id="historical-import-date-order" value={dateOrder} onChange={(e) => setDateOrder(e.target.value as DateOrder)}>
            <option value="DMY">Day/Month/Year</option>
            <option value="MDY">Month/Day/Year</option>
          </SelectField>
          <TextField label="Timezone" id="historical-import-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </div>
      </Card>

      <Card className="space-y-3">
        <p className="font-medium text-neutral-900">Upload WhatsApp export</p>
        <input ref={fileInputRef} type="file" accept=".txt,.zip" className="block w-full text-sm" />
        <Button type="button" disabled={isPending} onClick={handleUploadPreview}>
          {isPending ? "Reading…" : "Preview"}
        </Button>
      </Card>

      <Card className="space-y-3">
        <p className="font-medium text-neutral-900">Paste conversation</p>
        <TextAreaField
          label="Conversation text"
          id="historical-import-pasted-text"
          rows={8}
          value={pastedText}
          onChange={(e) => setPastedText(e.target.value)}
          placeholder="27/07/26, 14:05 - Juan Pérez: Hola…"
        />
        <Button type="button" disabled={isPending || pastedText.trim().length === 0} onClick={handlePastePreview}>
          {isPending ? "Reading…" : "Preview"}
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
