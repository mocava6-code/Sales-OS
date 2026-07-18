import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { listLeads } from "@/server/services/lead-service";
import { Card } from "@/components/ui/Card";

export default async function LeadsPage() {
  const user = await verifySession();
  const leads = await listLeads(user.businessId);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-neutral-900">Leads</h1>
        <Link
          href="/leads/new"
          className="rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          New lead
        </Link>
      </header>

      {leads.length === 0 ? (
        <Card className="text-sm text-neutral-500">No leads yet — add your first one.</Card>
      ) : (
        <ul className="space-y-2">
          {leads.map((lead) => (
            <li key={lead.id}>
              <Link href={`/leads/${lead.id}`}>
                <Card className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-neutral-900">{lead.name}</p>
                    <p className="text-sm text-neutral-500">{lead.phone}</p>
                  </div>
                  {lead.priority === "HIGH" && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      High priority
                    </span>
                  )}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
