import { Card } from "@/components/ui/Card";

export function DailyInsightEmptyState() {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-neutral-900">What we learned yesterday</h2>
      <Card className="text-sm text-neutral-500">
        No insight yet — this shows up once conversations are logged and daily summaries are
        generated.
      </Card>
    </section>
  );
}
