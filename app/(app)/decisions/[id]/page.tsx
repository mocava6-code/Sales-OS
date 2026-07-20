import { notFound } from "next/navigation";
import { verifySession } from "@/lib/auth/dal";
import { DecisionActions } from "@/components/decisions/DecisionActions";
import { DecisionReviewCard } from "@/components/decisions/DecisionReviewCard";
import { loadAuthorizedDecisionRecord } from "@/server/application/access-control";
import { toDecisionSummaryDTO } from "@/server/application/dto";
import { NotFoundError } from "@/server/application/errors";

export default async function DecisionReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await verifySession();

  const saved = await loadAuthorizedDecisionRecord(user, id).catch((error) => {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  });

  const decision = toDecisionSummaryDTO(saved);

  return (
    <div className="space-y-4">
      <DecisionReviewCard decision={decision} />
      <DecisionActions
        decisionRecordId={decision.id}
        status={decision.status}
        role={user.role}
        approvalRequirement={decision.approvalRequirement}
      />
    </div>
  );
}
