"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextField } from "@/components/ui/Field";
import { processSyncBatchAction, startWebsiteSyncAction } from "@/server/actions/knowledge";

const TERMINAL_STATUSES = ["COMPLETED", "PARTIAL", "FAILED"];

interface SyncProgress {
  sourceId: string;
  status: string;
  completed: number;
  total: number;
}

export function WebsiteSyncPanel({ defaultRootUrl }: { defaultRootUrl: string }) {
  const [rootUrl, setRootUrl] = useState(defaultRootUrl);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSync() {
    setError(null);
    startTransition(async () => {
      const started = await startWebsiteSyncAction({ rootUrl });
      if (!started.ok) {
        setError(started.error.message);
        return;
      }

      const total = started.data.discoveredCount;
      let completed = 0;
      setProgress({ sourceId: started.data.sourceId, status: "PROCESSING", completed, total });

      // "Sync started -> PROCESSING -> progress -> COMPLETED/PARTIAL/FAILED" —
      // each iteration is one bounded batch; nothing here holds one request
      // open for the whole site, this loop just keeps asking for the next one.
      let status = "PROCESSING";
      while (!TERMINAL_STATUSES.includes(status)) {
        const batch = await processSyncBatchAction({ sourceId: started.data.sourceId });
        if (!batch.ok) {
          setError(batch.error.message);
          return;
        }
        completed = total - batch.data.remaining;
        status = batch.data.sourceStatus;
        setProgress({ sourceId: started.data.sourceId, status, completed, total });
      }
    });
  }

  return (
    <Card className="space-y-3">
      <p className="font-medium text-neutral-900">Sincronizar sitio web</p>
      <TextField label="URL raíz" id="website-root-url" value={rootUrl} onChange={(e) => setRootUrl(e.target.value)} />
      <Button type="button" disabled={isPending} onClick={handleSync}>
        {isPending ? "Sincronizando…" : "Sincronizar ahora"}
      </Button>

      {progress && (
        <p className="text-sm text-neutral-600">
          {progress.status === "PROCESSING"
            ? `Procesando… ${progress.completed}/${progress.total} páginas`
            : `${progress.status === "COMPLETED" ? "Completado" : progress.status === "PARTIAL" ? "Completado con algunos errores" : "Fallido"} — ${progress.completed}/${progress.total} páginas`}
        </p>
      )}
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
