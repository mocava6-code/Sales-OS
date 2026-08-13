import { verifySession } from "@/lib/auth/dal";
import { Card } from "@/components/ui/Card";
import { ImportConversationPanel } from "@/components/knowledge/ImportConversationPanel";

export default async function KnowledgeImportPage() {
  const user = await verifySession();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Importaciones de conversaciones</h1>
      <p className="text-sm text-neutral-500">
        Sales OS lee la conversación y obtiene el conocimiento automáticamente — nada aquí se ingresa manualmente.
      </p>

      {user.role === "OWNER" ? (
        <ImportConversationPanel />
      ) : (
        <Card className="text-sm text-neutral-500">Solo el propietario del negocio puede importar conversaciones.</Card>
      )}
    </div>
  );
}
