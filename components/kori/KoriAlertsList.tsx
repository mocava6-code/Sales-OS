import { Card } from "@/components/ui/Card";
import type { KoriBriefing } from "@/server/services/kori-briefing-service";

export function KoriAlertsList({ alerts }: { alerts: KoriBriefing["alerts"] }) {
  const messages: string[] = [];

  if (alerts.staleReplyCount > 0) {
    messages.push(
      `${alerts.staleReplyCount} ${alerts.staleReplyCount === 1 ? "conversación lleva" : "conversaciones llevan"} más de 48 horas sin respuesta.`,
    );
  }
  if (alerts.unassignedHighPriorityCount > 0) {
    messages.push(
      `${alerts.unassignedHighPriorityCount} ${alerts.unassignedHighPriorityCount === 1 ? "cliente de alta prioridad está" : "clientes de alta prioridad están"} sin asesor asignado.`,
    );
  }

  if (messages.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-0.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Alertas</h2>
        <span className="font-mono text-xs text-neutral-400">{messages.length}</span>
      </div>
      <div className="space-y-2">
        {messages.map((message) => (
          <Card key={message} className="flex items-center gap-3">
            <span className="h-2 w-2 shrink-0 rounded-full bg-red-600" />
            <span className="text-sm text-neutral-700">{message}</span>
          </Card>
        ))}
      </div>
    </section>
  );
}
