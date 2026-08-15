import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/auth/dal";
import { getLead } from "@/server/services/lead-service";
import { Card } from "@/components/ui/Card";
import { FollowUpItem } from "@/components/follow-ups/FollowUpItem";
import { LeadCommercialStateCard } from "@/components/leads/LeadCommercialStateCard";
import { buildLeadCommercialState } from "@/server/lead-commercial-state/build-lead-commercial-state";
import { NoConversationsForLeadError } from "@/server/intelligence/lead-commercial-state/errors";
import type { LeadCommercialStateDTO } from "@/server/lead-commercial-state/types";
import { formatDate, formatDateTime } from "@/lib/copy/format";
import { CONVERSATION_STATUS_LABELS } from "@/lib/copy/labels";
import { RecordOutcomeSheet } from "@/components/outcomes/RecordOutcomeSheet";
import { AnalyzeConversationButton } from "@/components/leads/AnalyzeConversationButton";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await verifySession();
  const lead = await getLead(user.businessId, id);

  if (!lead) {
    notFound();
  }

  // A lead with no conversations yet has no commercial state to derive —
  // the card is simply omitted (same "not yet" spirit as the empty states
  // already used below for follow-ups/conversations), not an error.
  let commercialState: LeadCommercialStateDTO | null = null;
  try {
    commercialState = buildLeadCommercialState(lead, lead.business.timezone);
  } catch (error) {
    if (!(error instanceof NoConversationsForLeadError)) {
      throw error;
    }
  }

  const pendingFollowUps = lead.followUps.filter((f) => f.status === "PENDING");
  const otherFollowUps = lead.followUps.filter((f) => f.status !== "PENDING");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">{lead.name}</h1>
        <p className="text-sm text-neutral-500">{lead.phone}</p>
        {lead.priority === "HIGH" && (
          <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            Alta prioridad
          </span>
        )}
      </header>

      <div className="flex gap-2">
        <Link
          href={`/leads/${lead.id}/conversations/new`}
          className="flex-1 rounded-xl bg-neutral-900 px-4 py-2.5 text-center text-sm font-medium text-white"
        >
          Registrar conversación
        </Link>
        <Link
          href={`/leads/${lead.id}/follow-ups/new`}
          className="flex-1 rounded-xl border border-neutral-300 px-4 py-2.5 text-center text-sm font-medium text-neutral-700"
        >
          Agregar seguimiento
        </Link>
      </div>

      {lead.conversations.length > 0 && (
        <>
          <RecordOutcomeSheet conversationId={lead.conversations[0].id} suggestedProduct={commercialState?.productInterest.value ?? null} />
          <AnalyzeConversationButton conversationId={lead.conversations[0].id} />
        </>
      )}

      {commercialState && <LeadCommercialStateCard state={commercialState} />}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-neutral-500">Seguimientos</h2>
        <Card>
          {pendingFollowUps.length === 0 && otherFollowUps.length === 0 ? (
            <p className="text-sm text-neutral-400">Todavía no hay seguimientos.</p>
          ) : (
            <>
              {pendingFollowUps.length > 0 && (
                <ul className="divide-y divide-neutral-100">
                  {pendingFollowUps.map((followUp) => (
                    <FollowUpItem
                      key={followUp.id}
                      id={followUp.id}
                      leadId={lead.id}
                      leadName={lead.name}
                      dueAt={followUp.dueAt}
                      note={followUp.note}
                    />
                  ))}
                </ul>
              )}
              {otherFollowUps.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-neutral-100 pt-2">
                  {otherFollowUps.map((followUp) => (
                    <li key={followUp.id} className="text-sm text-neutral-400 line-through">
                      Vence {formatDate(followUp.dueAt)}
                      {followUp.note ? ` — ${followUp.note}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-neutral-500">Conversaciones</h2>
        {lead.conversations.length === 0 ? (
          <Card className="text-sm text-neutral-400">Todavía no hay conversaciones registradas.</Card>
        ) : (
          <div className="space-y-3">
            {lead.conversations.map((conversation) => (
              <Card key={conversation.id}>
                <p className="text-xs font-medium text-neutral-400">
                  {formatDateTime(conversation.lastEntryAt)} ·{" "}
                  {conversation.status === "NEEDS_REPLY" ? CONVERSATION_STATUS_LABELS.NEEDS_REPLY : "Registrada"}
                </p>
                <ul className="mt-2 space-y-1">
                  {conversation.entries.map((entry) => (
                    <li key={entry.id} className="text-sm">
                      <span className="font-medium text-neutral-500">
                        {entry.direction === "INBOUND" ? "Cliente: " : "Tú: "}
                      </span>
                      <span className="text-neutral-800">{entry.content}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
