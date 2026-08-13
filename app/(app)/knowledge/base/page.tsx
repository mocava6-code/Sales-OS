import { verifySession } from "@/lib/auth/dal";
import { Card } from "@/components/ui/Card";
import { listActiveKnowledgeItems, listActiveOperationalInsights } from "@/server/knowledge/queries";
import { formatDate } from "@/lib/copy/format";
import { KNOWLEDGE_CATEGORY_LABELS } from "@/lib/copy/labels";

export default async function KnowledgeBasePage() {
  const user = await verifySession();
  const [items, insights] = await Promise.all([
    listActiveKnowledgeItems(user.businessId),
    listActiveOperationalInsights(user.businessId),
  ]);

  const byCategory = new Map<string, typeof items>();
  for (const item of items) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Base de conocimiento</h1>

      {items.length === 0 && insights.length === 0 && (
        <Card className="text-sm text-neutral-500">Todavía no hay nada aprobado — revisa los candidatos para construir esta base.</Card>
      )}

      {[...byCategory.entries()].map(([category, categoryItems]) => (
        <section key={category} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{KNOWLEDGE_CATEGORY_LABELS[category] ?? category}</h2>
          {categoryItems.map((item) => (
            <Card key={item.id} className="space-y-1">
              <p className="font-medium text-neutral-900">{item.title}</p>
              <p className="text-sm text-neutral-700">{item.content}</p>
              {item.expiresAt && (
                <p className="text-xs text-amber-600">Expira el {formatDate(item.expiresAt)} — vuelve a verificarlo antes de esa fecha.</p>
              )}
            </Card>
          ))}
        </section>
      ))}

      {insights.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Proceso de ventas</h2>
          {insights.map((insight) => (
            <Card key={insight.id} className="space-y-1">
              <p className="text-sm text-neutral-700">{insight.statement}</p>
              <p className="text-xs text-neutral-400">observado {insight.occurrenceCount}×</p>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
