import { verifySession } from "@/lib/auth/dal";
import { Card } from "@/components/ui/Card";
import { WebsiteSyncPanel } from "@/components/knowledge/WebsiteSyncPanel";
import { listKnowledgeSources } from "@/server/knowledge/queries";
import { formatDateTime } from "@/lib/copy/format";
import { KNOWLEDGE_SOURCE_STATUS_LABELS } from "@/lib/copy/labels";

export default async function KnowledgeWebsitePage() {
  const user = await verifySession();
  const sources = (await listKnowledgeSources(user.businessId)).filter((s) => s.sourceType === "WEBSITE");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Sitio web</h1>

      {user.role === "OWNER" ? (
        <WebsiteSyncPanel defaultRootUrl="https://koriakiimport.com" />
      ) : (
        <Card className="text-sm text-neutral-500">Solo el propietario del negocio puede iniciar una sincronización del sitio web.</Card>
      )}

      <div className="space-y-2">
        {sources.map((source) => (
          <Card key={source.id}>
            <p className="font-medium text-neutral-900">{source.label}</p>
            <p className="text-sm text-neutral-500">
              {KNOWLEDGE_SOURCE_STATUS_LABELS[source.status] ?? source.status} · {source._count.websitePages} página{source._count.websitePages === 1 ? "" : "s"}
              {source.lastSyncedAt ? ` · última sincronización ${formatDateTime(source.lastSyncedAt)}` : ""}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}
