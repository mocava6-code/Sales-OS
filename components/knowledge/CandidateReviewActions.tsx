"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { promoteCandidateAction, rejectCandidateAction } from "@/server/actions/knowledge";

export function CandidateReviewActions({ candidateId }: { candidateId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handlePromote() {
    setError(null);
    startTransition(async () => {
      const result = await promoteCandidateAction({ candidateId });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  function handleReject() {
    setError(null);
    startTransition(async () => {
      const result = await rejectCandidateAction({ candidateId });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Button type="button" variant="primary" disabled={isPending} onClick={handlePromote}>
          Aprobar
        </Button>
        <Button type="button" variant="danger" disabled={isPending} onClick={handleReject}>
          Rechazar
        </Button>
      </div>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
