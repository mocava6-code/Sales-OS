import { verifySession } from "@/lib/auth/dal";
import { Card } from "@/components/ui/Card";
import { WebsiteSyncPanel } from "@/components/knowledge/WebsiteSyncPanel";
import { listKnowledgeSources } from "@/server/knowledge/queries";

export default async function KnowledgeWebsitePage() {
  const user = await verifySession();
  const sources = (await listKnowledgeSources(user.businessId)).filter((s) => s.sourceType === "WEBSITE");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Website</h1>

      {user.role === "OWNER" ? (
        <WebsiteSyncPanel defaultRootUrl="https://koriakiimport.com" />
      ) : (
        <Card className="text-sm text-neutral-500">Only the business owner can trigger a website sync.</Card>
      )}

      <div className="space-y-2">
        {sources.map((source) => (
          <Card key={source.id}>
            <p className="font-medium text-neutral-900">{source.label}</p>
            <p className="text-sm text-neutral-500">
              {source.status} · {source._count.websitePages} page{source._count.websitePages === 1 ? "" : "s"}
              {source.lastSyncedAt ? ` · last synced ${source.lastSyncedAt.toLocaleString()}` : ""}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}
