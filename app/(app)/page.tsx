import { verifySession } from "@/lib/auth/dal";
import { listHighPriorityLeads } from "@/server/services/lead-service";
import { listUnansweredConversations } from "@/server/services/conversation-service";
import { listOverdueFollowUps } from "@/server/services/follow-up-service";
import { ActionsList } from "@/components/today/ActionsList";
import { StartFlowEmptyState } from "@/components/today/StartFlowEmptyState";
import { DailyInsightEmptyState } from "@/components/today/DailyInsightEmptyState";

export default async function TodayPage() {
  const user = await verifySession();

  const [unansweredConversations, overdueFollowUps, highPriorityLeads] = await Promise.all([
    listUnansweredConversations(user.businessId),
    listOverdueFollowUps(user.businessId),
    listHighPriorityLeads(user.businessId),
  ]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Today</h1>
        <p className="text-sm text-neutral-500">Welcome back, {user.name.split(" ")[0]}</p>
      </header>

      <ActionsList
        unansweredConversations={unansweredConversations}
        overdueFollowUps={overdueFollowUps}
        highPriorityLeads={highPriorityLeads}
      />

      <StartFlowEmptyState />
      <DailyInsightEmptyState />
    </div>
  );
}
