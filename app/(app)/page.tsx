import { verifySession } from "@/lib/auth/dal";
import { listHighPriorityLeads } from "@/server/services/lead-service";
import { listOverdueFollowUps } from "@/server/services/follow-up-service";
import { groupLeadsByOperationalActionState } from "@/server/services/conversation-action-state-service";
import { ActionsList } from "@/components/today/ActionsList";
import { OperationalActionsList } from "@/components/today/OperationalActionsList";
import { StartFlowEmptyState } from "@/components/today/StartFlowEmptyState";
import { DailyInsightEmptyState } from "@/components/today/DailyInsightEmptyState";

export default async function TodayPage() {
  const user = await verifySession();
  const now = new Date();

  const [operationalGroups, overdueFollowUps, highPriorityLeads] = await Promise.all([
    groupLeadsByOperationalActionState(user.businessId),
    listOverdueFollowUps(user.businessId),
    listHighPriorityLeads(user.businessId),
  ]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Today</h1>
        <p className="text-sm text-neutral-500">Welcome back, {user.name.split(" ")[0]}</p>
      </header>

      <OperationalActionsList groups={operationalGroups} now={now} />

      <ActionsList overdueFollowUps={overdueFollowUps} highPriorityLeads={highPriorityLeads} />

      <StartFlowEmptyState />
      <DailyInsightEmptyState />
    </div>
  );
}
