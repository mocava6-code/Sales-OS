import { formatGreeting } from "@/lib/copy/format";
import { buildPulseSummary, type KoriBriefing } from "@/server/services/kori-briefing-service";

export function KoriPulseHeader({
  firstName,
  briefing,
  now,
  commercialConversationsThisMonth,
}: {
  firstName: string;
  briefing: KoriBriefing;
  now: Date;
  commercialConversationsThisMonth?: number;
}) {
  return (
    <header className="pb-2 pt-1">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-bold tracking-wide text-indigo-700">
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-700" />
        KORI
      </div>
      <h1 className="text-2xl font-semibold text-neutral-900">
        {formatGreeting(now)}, {firstName}
      </h1>
      <p className="mt-1 text-sm leading-relaxed text-neutral-500">{buildPulseSummary(briefing, commercialConversationsThisMonth)}</p>
    </header>
  );
}
