"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { SelectField, TextAreaField } from "@/components/ui/Field";
import {
  type DecisionActionKind,
  getAvailableDecisionActions,
  requiresNote,
} from "@/lib/decisions/available-actions";
import type { ApprovalRequirement, DecisionStatus } from "@/server/intelligence/decision/types";
import {
  approveDecisionAction,
  executeDecisionAction,
  recordAdvisorOverrideAction,
  rejectDecisionAction,
} from "@/server/actions/decisions";

const ACTION_LABELS: Record<DecisionActionKind, string> = {
  APPROVE: "Approve",
  REJECT: "Reject",
  OVERRIDE: "Record override",
  EXECUTE: "Mark executed",
};

const ACTION_VARIANTS: Record<DecisionActionKind, "primary" | "secondary" | "danger"> = {
  APPROVE: "primary",
  EXECUTE: "primary",
  REJECT: "danger",
  OVERRIDE: "secondary",
};

const OVERRIDE_ACTION_TYPE_OPTIONS = [
  { value: "IGNORED_RECOMMENDATION", label: "Ignored the recommendation" },
  { value: "PARTIALLY_FOLLOWED_RECOMMENDATION", label: "Partially followed it" },
  { value: "CUSTOM_ACTION", label: "Did something else entirely" },
] as const;

type OverrideActionType = (typeof OVERRIDE_ACTION_TYPE_OPTIONS)[number]["value"];

export function DecisionActions({
  decisionRecordId,
  status,
  role,
  approvalRequirement,
}: {
  decisionRecordId: string;
  status: DecisionStatus;
  role: "OWNER" | "SALESPERSON";
  approvalRequirement: ApprovalRequirement;
}) {
  const [currentStatus, setCurrentStatus] = useState(status);
  const [activeAction, setActiveAction] = useState<DecisionActionKind | null>(null);
  const [note, setNote] = useState("");
  const [overrideActionType, setOverrideActionType] = useState<OverrideActionType>("CUSTOM_ACTION");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const availableActions = getAvailableDecisionActions(currentStatus, role, approvalRequirement);

  function handleClick(action: DecisionActionKind) {
    setError(null);

    if (requiresNote(action) && activeAction !== action) {
      setActiveAction(action);
      return;
    }

    startTransition(async () => {
      const result = await dispatch(action);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setCurrentStatus(result.data.status);
      setActiveAction(null);
      setNote("");
    });
  }

  async function dispatch(action: DecisionActionKind) {
    switch (action) {
      case "APPROVE":
        return approveDecisionAction({ decisionRecordId, note: note || undefined });
      case "REJECT":
        return rejectDecisionAction({ decisionRecordId, note });
      case "EXECUTE":
        return executeDecisionAction({ decisionRecordId, note: note || undefined });
      case "OVERRIDE":
        return recordAdvisorOverrideAction({ decisionRecordId, actionType: overrideActionType, notes: note });
    }
  }

  if (availableActions.length === 0) {
    return (
      <p className="text-sm text-neutral-400">
        No further action available — this decision is {currentStatus.toLowerCase()}.
      </p>
    );
  }

  const confirming = activeAction !== null && requiresNote(activeAction);

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {confirming && (
        <div className="space-y-3">
          {activeAction === "OVERRIDE" && (
            <SelectField
              label="What did the advisor do instead?"
              id="override-action-type"
              value={overrideActionType}
              onChange={(e) => setOverrideActionType(e.target.value as OverrideActionType)}
            >
              {OVERRIDE_ACTION_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          )}
          <TextAreaField
            label={activeAction === "OVERRIDE" ? "What did you do instead?" : "Why are you rejecting this?"}
            id="decision-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required
          />
        </div>
      )}

      <div className="flex gap-2">
        {availableActions.map((action) => {
          const isConfirmingThis = activeAction === action && requiresNote(action);
          return (
            <Button
              key={action}
              type="button"
              variant={ACTION_VARIANTS[action]}
              disabled={isPending || (isConfirmingThis && note.trim().length === 0)}
              onClick={() => handleClick(action)}
            >
              {isConfirmingThis ? `Confirm ${ACTION_LABELS[action].toLowerCase()}` : ACTION_LABELS[action]}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
