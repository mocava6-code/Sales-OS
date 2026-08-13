import { Card } from "@/components/ui/Card";

export function StartFlowEmptyState() {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-neutral-900">Empezar</h2>
      <Card className="text-sm text-neutral-500">
        La guía paso a paso de las acciones de hoy todavía no está lista — por ahora, trabaja
        la lista de arriba manualmente.
      </Card>
    </section>
  );
}
