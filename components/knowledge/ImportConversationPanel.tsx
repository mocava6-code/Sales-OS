"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextAreaField } from "@/components/ui/Field";
import { analyzePastedConversationAction, analyzeUploadedConversationAction } from "@/server/actions/knowledge";

type PendingImport = { rawText: string; externalSource: "PASTED_TEXT" | "WHATSAPP_TXT_EXPORT" | "WHATSAPP_ZIP_EXPORT"; sourceConversationId: string; rawFileHash?: string };

type ViewState =
  | { kind: "IDLE" }
  | { kind: "NEEDS_RESOLUTION"; candidateLabels: [string, string]; pending: PendingImport }
  | { kind: "COMPLETED"; summary: { messagesAnalyzed: number; candidatesFound: number; reinforced: number; conflicts: number } }
  | { kind: "ERROR"; message: string };

export function ImportConversationPanel() {
  const [pastedText, setPastedText] = useState("");
  const [view, setView] = useState<ViewState>({ kind: "IDLE" });
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handlePasteAnalyze() {
    if (pastedText.trim().length === 0) return;
    startTransition(async () => {
      const result = await analyzePastedConversationAction({
        rawText: pastedText,
        externalSource: "PASTED_TEXT",
        sourceConversationId: `pasted-${Date.now()}`,
      });
      applyResult(result, { rawText: pastedText, externalSource: "PASTED_TEXT", sourceConversationId: `pasted-${Date.now()}` });
    });
  }

  function handleFileAnalyze() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);
      const result = await analyzeUploadedConversationAction(formData);
      // Uploaded files can't be resubmitted from pendingImport state (we
      // don't keep the raw bytes around) — if participant resolution is
      // needed for an upload, the resolution buttons re-run the paste path
      // with rawText echoed back by the server action isn't available here,
      // so uploads that need resolution ask the user to re-upload after
      // answering. This is a deliberate v1 simplification.
      if (result.ok && "status" in result.data && result.data.status === "NEEDS_PARTICIPANT_RESOLUTION") {
        setView({ kind: "ERROR", message: "This export has an ambiguous sender. Re-upload and use Paste instead so we can ask which participant is Koriaki." });
        return;
      }
      applyResult(result, null);
    });
  }

  function applyResult(
    result: Awaited<ReturnType<typeof analyzePastedConversationAction>>,
    fallbackPending: PendingImport | null,
  ) {
    if (!result.ok) {
      setView({ kind: "ERROR", message: result.error.message });
      return;
    }
    if (result.data.status === "NEEDS_PARTICIPANT_RESOLUTION") {
      if (!fallbackPending) {
        setView({ kind: "ERROR", message: "This conversation has an ambiguous sender and couldn't be resolved." });
        return;
      }
      setView({ kind: "NEEDS_RESOLUTION", candidateLabels: result.data.candidateLabels, pending: fallbackPending });
      return;
    }
    setView({ kind: "COMPLETED", summary: result.data.summary });
  }

  function handleResolve(label: string) {
    if (view.kind !== "NEEDS_RESOLUTION") return;
    const pending = view.pending;
    startTransition(async () => {
      const result = await analyzePastedConversationAction({ ...pending, manualBusinessSenderLabel: label });
      applyResult(result, pending);
    });
  }

  if (view.kind === "NEEDS_RESOLUTION") {
    return (
      <Card className="space-y-3">
        <p className="font-medium text-neutral-900">Which participant is Koriaki?</p>
        <p className="text-sm text-neutral-500">This is metadata resolution, not manual knowledge entry — it just tells us who&apos;s who.</p>
        <div className="flex gap-2">
          {view.candidateLabels.map((label) => (
            <Button key={label} type="button" variant="secondary" disabled={isPending} onClick={() => handleResolve(label)}>
              {label}
            </Button>
          ))}
        </div>
      </Card>
    );
  }

  if (view.kind === "COMPLETED") {
    const { summary } = view;
    return (
      <Card className="space-y-1">
        <p className="text-sm text-neutral-900">{summary.messagesAnalyzed} messages analyzed</p>
        <p className="text-sm text-neutral-900">{summary.candidatesFound} reusable knowledge candidates</p>
        <p className="text-sm text-neutral-900">{summary.reinforced} existing facts reinforced</p>
        <p className={`text-sm ${summary.conflicts > 0 ? "text-red-600" : "text-neutral-900"}`}>
          {summary.conflicts} conflict{summary.conflicts === 1 ? "" : "s"} detected
        </p>
        <Button type="button" variant="secondary" className="mt-2" onClick={() => setView({ kind: "IDLE" })}>
          Analyze another
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <p className="font-medium text-neutral-900">Upload WhatsApp export</p>
        <input ref={fileInputRef} type="file" accept=".txt,.zip" className="block w-full text-sm" />
        <Button type="button" disabled={isPending} onClick={handleFileAnalyze}>
          {isPending ? "Analyzing…" : "Analyze"}
        </Button>
      </Card>

      <Card className="space-y-3">
        <p className="font-medium text-neutral-900">Paste conversation</p>
        <TextAreaField
          label="Conversation text"
          id="pasted-conversation"
          rows={8}
          value={pastedText}
          onChange={(e) => setPastedText(e.target.value)}
          placeholder="27/07/26, 14:05 - Juan Pérez: Hola…"
        />
        <Button type="button" disabled={isPending || pastedText.trim().length === 0} onClick={handlePasteAnalyze}>
          {isPending ? "Analyzing…" : "Analyze"}
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
