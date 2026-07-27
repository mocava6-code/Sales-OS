import { verifySession } from "@/lib/auth/dal";
import { Card } from "@/components/ui/Card";
import { listActiveKnowledgeItems, listActiveOperationalInsights } from "@/server/knowledge/queries";

const CATEGORY_LABELS: Record<string, string> = {
  PRODUCT: "Product",
  COMPATIBILITY: "Compatibility",
  LOGISTICS: "Logistics",
  PRICING: "Pricing",
  COMMERCIAL_POLICY: "Commercial Policy",
  PROMOTION: "Promotion",
  FAQ: "FAQ",
  OBJECTION: "Objection",
  RECOMMENDED_RESPONSE: "Recommended Response",
};

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
      <h1 className="text-2xl font-semibold text-neutral-900">Knowledge Base</h1>

      {items.length === 0 && insights.length === 0 && (
        <Card className="text-sm text-neutral-500">Nothing approved yet — review candidates to build this up.</Card>
      )}

      {[...byCategory.entries()].map(([category, categoryItems]) => (
        <section key={category} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{CATEGORY_LABELS[category] ?? category}</h2>
          {categoryItems.map((item) => (
            <Card key={item.id} className="space-y-1">
              <p className="font-medium text-neutral-900">{item.title}</p>
              <p className="text-sm text-neutral-700">{item.content}</p>
              {item.expiresAt && (
                <p className="text-xs text-amber-600">Expires {item.expiresAt.toLocaleDateString()} — re-verify before then.</p>
              )}
            </Card>
          ))}
        </section>
      ))}

      {insights.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Sales Process</h2>
          {insights.map((insight) => (
            <Card key={insight.id} className="space-y-1">
              <p className="text-sm text-neutral-700">{insight.statement}</p>
              <p className="text-xs text-neutral-400">observed {insight.occurrenceCount}×</p>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
