import { verifySession } from "@/lib/auth/dal";
import { Card } from "@/components/ui/Card";
import { ImportConversationPanel } from "@/components/knowledge/ImportConversationPanel";

export default async function KnowledgeImportPage() {
  const user = await verifySession();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Conversation Imports</h1>
      <p className="text-sm text-neutral-500">
        Sales OS reads the conversation and derives knowledge automatically — nothing here is manual knowledge entry.
      </p>

      {user.role === "OWNER" ? (
        <ImportConversationPanel />
      ) : (
        <Card className="text-sm text-neutral-500">Only the business owner can import conversations.</Card>
      )}
    </div>
  );
}
