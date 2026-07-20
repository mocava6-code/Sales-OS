// Pure UI logic: which action buttons the Decision Review surface should
// show, given a decision's current status and the viewer's role/authorization.
// No rendering, no data fetching — fully unit-testable on its own, and
// reused by components/decisions/DecisionActions.tsx so the UI and its
// tests can never drift from each other.

import type { ApprovalRequirement, DecisionStatus } from "@/server/intelligence/decision/types";
import type { AuthenticatedUser } from "@/server/application/auth";

export type DecisionActionKind = "APPROVE" | "REJECT" | "OVERRIDE" | "EXECUTE";

/**
 * Mirrors server/application/access-control.ts' assertCanApprove exactly —
 * only APPROVE is gated by approvalRequirement; REJECT/OVERRIDE/EXECUTE only
 * require business membership, already guaranteed by the page having loaded
 * this decision for this user at all.
 */
export function getAvailableDecisionActions(
  status: DecisionStatus,
  role: AuthenticatedUser["role"],
  approvalRequirement: ApprovalRequirement,
): DecisionActionKind[] {
  const canApprove = approvalRequirement !== "ADMIN_APPROVAL_REQUIRED" || role === "OWNER";

  switch (status) {
    case "PROPOSED": {
      const actions: DecisionActionKind[] = [];
      if (canApprove) actions.push("APPROVE");
      actions.push("REJECT", "OVERRIDE");
      return actions;
    }
    case "APPROVED":
      return ["EXECUTE", "REJECT", "OVERRIDE"];
    case "REJECTED":
    case "EXECUTED":
    case "CANCELLED":
    case "OVERRIDDEN":
      return [];
  }
}

/** REJECT and OVERRIDE require a short note; APPROVE and EXECUTE don't. */
export function requiresNote(action: DecisionActionKind): boolean {
  return action === "REJECT" || action === "OVERRIDE";
}
