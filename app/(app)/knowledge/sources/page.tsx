import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { Card } from "@/components/ui/Card";
import { listKnowledgeSources } from "@/server/knowledge/queries";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  PROCESSING: "Processing…",
  COMPLETED: "Completed",
  PARTIAL: "Partial",
  FAILED: "Failed",
};

export default async function KnowledgeSourcesPage() {
  const user = await verifySession();
  const sources = await listKnowledgeSources(user.businessId);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Sources</h1>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/knowledge/sources/website">
          <Card className="text-center">
            <p className="font-medium text-neutral-900">Website</p>
            <p className="text-sm text-neutral-500">koriakiimport.com</p>
          </Card>
        </Link>
        <Link href="/knowledge/sources/import">
          <Card className="text-center">
            <p className="font-medium text-neutral-900">Conversation Imports</p>
            <p className="text-sm text-neutral-500">WhatsApp exports</p>
          </Card>
        </Link>
      </div>

      <div className="space-y-2">
        {sources.length === 0 && <p className="text-sm text-neutral-500">No sources yet.</p>}
        {sources.map((source) => (
          <Card key={source.id}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-neutral-900">{source.label}</p>
                <p className="text-sm text-neutral-500">
                  {source.sourceType === "WEBSITE" ? "Website" : "WhatsApp import"} · {STATUS_LABELS[source.status] ?? source.status}
                </p>
              </div>
              {source.status === "PROCESSING" && source.progressTotal ? (
                <span className="text-sm text-neutral-500">
                  {source.progressCompleted ?? 0}/{source.progressTotal}
                </span>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
