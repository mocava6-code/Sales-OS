import { notFound } from "next/navigation";
import { verifySession } from "@/lib/auth/dal";
import { DecisionActions } from "@/components/decisions/DecisionActions";
import { DecisionDraftReply } from "@/components/decisions/DecisionDraftReply";
import { DecisionReviewCard } from "@/components/decisions/DecisionReviewCard";
import { loadAuthorizedDecisionRecord } from "@/server/application/access-control";
import { toDecisionSummaryDTO } from "@/server/application/dto";
import { NotFoundError } from "@/server/application/errors";
import { PrismaConversationSnapshotRepository } from "@/server/persistence/prisma/prisma-conversation-snapshot-repository";

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

  // Kori's own draftResponse, if the conversation has one — the same
  // grounded draft the Conversation Intelligence engine already produces,
  // just never previously reachable from a decision review screen.
  const snapshot = await new PrismaConversationSnapshotRepository().findLatestForConversation(decision.conversationId);
  const draftText = snapshot?.result.draftResponse?.text ?? null;

  return (
    <div className="space-y-4">
      <DecisionReviewCard decision={decision} />
      <DecisionActions
        decisionRecordId={decision.id}
        status={decision.status}
        role={user.role}
        approvalRequirement={decision.approvalRequirement}
      />
      {draftText && <DecisionDraftReply decisionRecordId={decision.id} conversationId={decision.conversationId} draftText={draftText} />}
    </div>
  );
}
