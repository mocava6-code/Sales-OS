import { verifySession } from "@/lib/auth/dal";
import { getKoriBriefing } from "@/server/services/kori-briefing-service";
import { getKoriConversionIntelligence } from "@/server/services/conversion-intelligence-service";
import { resolveKoriDateToken, KORI_DEFAULT_TIMEZONE } from "@/server/kori/date-interpretation";
import { KoriPulseHeader } from "@/components/kori/KoriPulseHeader";
import { KoriStatStrip } from "@/components/kori/KoriStatStrip";
import { KoriOpportunitiesList } from "@/components/kori/KoriOpportunitiesList";
import { KoriAlertsList } from "@/components/kori/KoriAlertsList";
import { KoriDecisionsPreview } from "@/components/kori/KoriDecisionsPreview";
import { KoriDemandSignals } from "@/components/kori/KoriDemandSignals";
import { KoriConversionSummary } from "@/components/kori/KoriConversionSummary";
import { KoriChatDock } from "@/components/kori/KoriChatDock";

// Kori Commercial Intelligence Center v1 — the product's new front door
// (see the Phase 0 audit + roadmap). Every section is a SYNTHESIS of
// systems that already exist and are already trusted (Semantic Response
// Intelligence, the Kori query engine, the Decision Engine) — this page
// adds no new intelligence of its own, only a place to see it all at once,
// plus the same query engine available directly as a chat.
export default async function KoriPage() {
  const user = await verifySession();
  const now = new Date();
  const briefing = await getKoriBriefing(user.businessId, now);
  const monthStart = new Date(resolveKoriDateToken("THIS_MONTH_START", now, KORI_DEFAULT_TIMEZONE));
  const conversionSummary = await getKoriConversionIntelligence(user.businessId, monthStart, now, briefing.demandSignals);

  return (
    <div className="space-y-6 pb-4">
      <KoriPulseHeader
        firstName={user.name.split(" ")[0]}
        briefing={briefing}
        now={now}
        commercialConversationsThisMonth={conversionSummary.commercialConversations}
      />

      <KoriStatStrip stats={briefing.stats} />

      <KoriOpportunitiesList opportunities={briefing.opportunities} now={now} />

      <KoriAlertsList alerts={briefing.alerts} />

      <KoriDecisionsPreview decisions={briefing.pendingDecisions} now={now} />

      <KoriConversionSummary summary={conversionSummary} />

      <KoriDemandSignals
        demandSignals={briefing.demandSignals}
        demandWindowDays={briefing.demandWindowDays}
        demandSampleSize={briefing.demandSampleSize}
      />

      <KoriChatDock />
    </div>
  );
}
