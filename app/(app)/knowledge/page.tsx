import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { Card } from "@/components/ui/Card";
import { getKnowledgeDashboardCounts } from "@/server/knowledge/queries";

export default async function KnowledgePage() {
  const user = await verifySession();
  const counts = await getKnowledgeDashboardCounts(user.businessId);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Knowledge</h1>
      <p className="text-sm text-neutral-500">
        Acquired automatically from the Koriaki website and WhatsApp conversations — never typed in by hand.
      </p>

      <Link href="/knowledge/sources" className="block">
        <Card className="flex items-center justify-between">
          <div>
            <p className="font-medium text-neutral-900">Sources</p>
            <p className="text-sm text-neutral-500">{counts.sources} ingestion source{counts.sources === 1 ? "" : "s"}</p>
          </div>
          <span className="text-neutral-400">→</span>
        </Card>
      </Link>

      <Link href="/knowledge/candidates" className="block">
        <Card className="flex items-center justify-between">
          <div>
            <p className="font-medium text-neutral-900">Candidates</p>
            <p className="text-sm text-neutral-500">
              {counts.newCandidates} awaiting review
              {counts.conflictCandidates > 0 && <span className="text-red-600"> · {counts.conflictCandidates} conflict{counts.conflictCandidates === 1 ? "" : "s"}</span>}
            </p>
          </div>
          <span className="text-neutral-400">→</span>
        </Card>
      </Link>

      <Link href="/knowledge/base" className="block">
        <Card className="flex items-center justify-between">
          <div>
            <p className="font-medium text-neutral-900">Knowledge Base</p>
            <p className="text-sm text-neutral-500">
              {counts.knowledgeItems} approved fact{counts.knowledgeItems === 1 ? "" : "s"} · {counts.operationalInsights} process insight
              {counts.operationalInsights === 1 ? "" : "s"}
            </p>
          </div>
          <span className="text-neutral-400">→</span>
        </Card>
      </Link>
    </div>
  );
}
