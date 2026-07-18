import { notFound } from "next/navigation";
import { verifySession } from "@/lib/auth/dal";
import { getLead } from "@/server/services/lead-service";
import { FollowUpForm } from "@/components/follow-ups/FollowUpForm";

export default async function NewFollowUpPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await verifySession();
  const lead = await getLead(user.businessId, id);

  if (!lead) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Add follow-up</h1>
      <p className="text-sm text-neutral-500">for {lead.name}</p>
      <FollowUpForm leadId={lead.id} />
    </div>
  );
}
