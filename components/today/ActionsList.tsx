import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { FollowUpItem } from "@/components/follow-ups/FollowUpItem";

type UnansweredConversation = {
  id: string;
  lastEntryAt: Date;
  lead: { id: string; name: string };
};

type OverdueFollowUp = {
  id: string;
  leadId: string;
  dueAt: Date;
  note: string | null;
  lead: { id: string; name: string };
};

type HighPriorityLead = {
  id: string;
  name: string;
  status: string;
};

export function ActionsList({
  unansweredConversations,
  overdueFollowUps,
  highPriorityLeads,
}: {
  unansweredConversations: UnansweredConversation[];
  overdueFollowUps: OverdueFollowUp[];
  highPriorityLeads: HighPriorityLead[];
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-neutral-900">Actions requiring attention</h2>

      <Card>
        <h3 className="text-sm font-medium text-neutral-500">Unanswered customers</h3>
        {unansweredConversations.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-400">Nothing waiting on a reply.</p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-100">
            {unansweredConversations.map((conversation) => (
              <li key={conversation.id} className="py-2">
                <Link
                  href={`/leads/${conversation.lead.id}`}
                  className="font-medium text-neutral-900"
                >
                  {conversation.lead.name}
                </Link>
                <p className="text-sm text-neutral-500">
                  Waiting since {conversation.lastEntryAt.toLocaleDateString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-medium text-neutral-500">Overdue follow-ups</h3>
        {overdueFollowUps.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-400">No overdue follow-ups.</p>
        ) : (
          <ul className="mt-1 divide-y divide-neutral-100">
            {overdueFollowUps.map((followUp) => (
              <FollowUpItem
                key={followUp.id}
                id={followUp.id}
                leadId={followUp.leadId}
                leadName={followUp.lead.name}
                dueAt={followUp.dueAt}
                note={followUp.note}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-medium text-neutral-500">High-priority opportunities</h3>
        {highPriorityLeads.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-400">No high-priority leads right now.</p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-100">
            {highPriorityLeads.map((lead) => (
              <li key={lead.id} className="py-2">
                <Link href={`/leads/${lead.id}`} className="font-medium text-neutral-900">
                  {lead.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
