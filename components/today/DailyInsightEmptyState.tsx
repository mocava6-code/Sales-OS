import { Card } from "@/components/ui/Card";

export function DailyInsightEmptyState() {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-neutral-900">Lo que aprendimos ayer</h2>
      <Card className="text-sm text-neutral-500">
        Todavía no hay novedades — esto aparece una vez que se registran conversaciones y se
        generan los resúmenes diarios.
      </Card>
    </section>
  );
}
