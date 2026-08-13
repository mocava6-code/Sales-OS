import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { Card } from "@/components/ui/Card";
import { getKnowledgeDashboardCounts } from "@/server/knowledge/queries";

export default async function KnowledgePage() {
  const user = await verifySession();
  const counts = await getKnowledgeDashboardCounts(user.businessId);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Conocimiento</h1>
      <p className="text-sm text-neutral-500">
        Se obtiene automáticamente del sitio web de Koriaki y de las conversaciones de WhatsApp — nunca se escribe a mano.
      </p>

      <Link href="/knowledge/sources" className="block">
        <Card className="flex items-center justify-between">
          <div>
            <p className="font-medium text-neutral-900">Fuentes</p>
            <p className="text-sm text-neutral-500">{counts.sources} fuente{counts.sources === 1 ? "" : "s"} de ingestión</p>
          </div>
          <span className="text-neutral-400">→</span>
        </Card>
      </Link>

      <Link href="/knowledge/candidates" className="block">
        <Card className="flex items-center justify-between">
          <div>
            <p className="font-medium text-neutral-900">Candidatos</p>
            <p className="text-sm text-neutral-500">
              {counts.newCandidates} esperando revisión
              {counts.conflictCandidates > 0 && <span className="text-red-600"> · {counts.conflictCandidates} conflicto{counts.conflictCandidates === 1 ? "" : "s"}</span>}
            </p>
          </div>
          <span className="text-neutral-400">→</span>
        </Card>
      </Link>

      <Link href="/knowledge/base" className="block">
        <Card className="flex items-center justify-between">
          <div>
            <p className="font-medium text-neutral-900">Base de conocimiento</p>
            <p className="text-sm text-neutral-500">
              {counts.knowledgeItems} dato{counts.knowledgeItems === 1 ? "" : "s"} aprobado{counts.knowledgeItems === 1 ? "" : "s"} · {counts.operationalInsights} hallazgo{counts.operationalInsights === 1 ? "" : "s"} de proceso
            </p>
          </div>
          <span className="text-neutral-400">→</span>
        </Card>
      </Link>
    </div>
  );
}
