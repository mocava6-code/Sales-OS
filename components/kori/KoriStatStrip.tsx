import type { KoriBriefing } from "@/server/services/kori-briefing-service";

function StatTile({ value, label, tone }: { value: number; label: string; tone: "hot" | "warm" | "calm" }) {
  const toneClass = tone === "hot" ? "text-red-700" : tone === "warm" ? "text-amber-700" : "text-neutral-900";
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-2.5 py-2.5 text-left">
      <div className={`text-xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      <div className="mt-0.5 text-[11px] leading-tight text-neutral-400">{label}</div>
    </div>
  );
}

export function KoriStatStrip({ stats }: { stats: KoriBriefing["stats"] }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      <StatTile value={stats.replyRequiredCount} label="Requieren respuesta" tone={stats.replyRequiredCount > 0 ? "hot" : "calm"} />
      <StatTile value={stats.overdueFollowUpCount} label="Seguimientos vencidos" tone={stats.overdueFollowUpCount > 0 ? "warm" : "calm"} />
      <StatTile value={stats.newLeadsThisWeek} label="Nuevos esta semana" tone="calm" />
      <StatTile value={stats.pendingDecisionsCount} label="Decisiones por revisar" tone="calm" />
    </div>
  );
}
