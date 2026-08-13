import { notFound } from "next/navigation";
import { verifySession } from "@/lib/auth/dal";
import { getLead } from "@/server/services/lead-service";
import { ConversationForm } from "@/components/conversations/ConversationForm";

export default async function NewConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await verifySession();
  const lead = await getLead(user.businessId, id);

  if (!lead) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Registrar conversación</h1>
      <p className="text-sm text-neutral-500">con {lead.name}</p>
      <ConversationForm leadId={lead.id} />
    </div>
  );
}
