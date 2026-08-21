import { verifySession } from "@/lib/auth/dal";
import { Card } from "@/components/ui/Card";
import { getTeamPerformance } from "@/server/insights/team-performance";

// Finding 05 of the "Unwired Kori" product audit: this data was fully
// computed and tested with zero UI callers and no route. Advisors are never
// ranked against each other by name here — every number is that advisor vs.
// the team's own average (see team-performance.ts's own doc comment) — this
// page just renders what deriveTeamPerformance already refuses to turn into
// a leaderboard.

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return "Sin datos";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`;
}

function formatPercent(rate: number | null): string {
  return rate === null ? "Sin datos" : `${Math.round(rate * 100)}%`;
}

export default async function TeamPerformancePage() {
  const user = await verifySession();

  if (user.role !== "OWNER") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-neutral-900">Rendimiento del equipo</h1>
        <Card className="text-sm text-neutral-500">Solo el propietario del negocio puede ver el rendimiento del equipo.</Card>
      </div>
    );
  }

  const summary = await getTeamPerformance(user.businessId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900">Rendimiento del equipo</h1>
        <p className="text-sm text-neutral-500">Últimos {summary.periodDays} días</p>
      </div>

      <Card className="flex justify-between text-center">
        <div className="flex-1">
          <p className="text-xs uppercase tracking-wide text-neutral-400">Promedio de respuesta</p>
          <p className="mt-1 text-lg font-semibold text-neutral-900">{formatMinutes(summary.teamAverage.avgResponseTimeMinutes)}</p>
        </div>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-wide text-neutral-400">Conversión del equipo</p>
          <p className="mt-1 text-lg font-semibold text-neutral-900">{formatPercent(summary.teamAverage.conversionRate)}</p>
        </div>
      </Card>

      {summary.advisors.length === 0 ? (
        <Card className="text-sm text-neutral-500">Todavía no hay conversaciones asignadas a un asesor en este período.</Card>
      ) : (
        <div className="space-y-2">
          {summary.advisors.map((advisor) => (
            <Card key={advisor.advisorUserId} className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium text-neutral-900">{advisor.advisorName}</p>
                <p className="text-xs text-neutral-400">{advisor.conversationsHandled} conversaciones</p>
              </div>
              <div className="flex gap-4 text-sm text-neutral-600">
                <p>Respuesta: {formatMinutes(advisor.avgResponseTimeMinutes)}</p>
                <p>
                  Conversión: {formatPercent(advisor.conversionRate)}
                  {advisor.decided > 0 ? ` (${advisor.closed}/${advisor.decided})` : ""}
                </p>
              </div>
              {advisor.highlight && <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-900">✨ {advisor.highlight}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
