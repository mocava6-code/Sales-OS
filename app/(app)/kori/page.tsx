import { verifySession } from "@/lib/auth/dal";
import { getKoriBriefing } from "@/server/services/kori-briefing-service";
import { getKoriConversionIntelligence } from "@/server/services/conversion-intelligence-service";
import { getKoriInsights } from "@/server/services/kori-insights-service";
import { resolveKoriDateToken, KORI_DEFAULT_TIMEZONE } from "@/server/kori/date-interpretation";
import { KoriPulseHeader } from "@/components/kori/KoriPulseHeader";
import { KoriInsights } from "@/components/kori/KoriInsights";
import { KoriStatStrip } from "@/components/kori/KoriStatStrip";
import { KoriOpportunitiesList } from "@/components/kori/KoriOpportunitiesList";
import { KoriNeedsOutcomeNudges } from "@/components/kori/KoriNeedsOutcomeNudges";
import { KoriAlertsList } from "@/components/kori/KoriAlertsList";
import { KoriDecisionsPreview } from "@/components/kori/KoriDecisionsPreview";
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
  // Kori Commercial Intelligence V2 — "Aprendizajes de Kori" replaces the
  // old Conversion Summary + Demand Signals sections (see the V2 strategy
  // doc's Fase 3): fewer sections, unified demand+conversion per product,
  // never two pipelines quietly disagreeing with each other.
  const insights = await getKoriInsights(user.businessId, now, {
    commercialConversations: conversionSummary.commercialConversations,
    needsOutcomeNudges: briefing.needsOutcomeNudges,
  });

  return (
    <div className="space-y-6 pb-4">
      <KoriPulseHeader
        firstName={user.name.split(" ")[0]}
        briefing={briefing}
        now={now}
        commercialConversationsThisMonth={conversionSummary.commercialConversations}
      />

      <KoriInsights insights={insights} canImportHistory={user.role === "OWNER"} />

      <KoriStatStrip stats={briefing.stats} />

      <KoriOpportunitiesList opportunities={briefing.opportunities} now={now} />

      <KoriNeedsOutcomeNudges nudges={briefing.needsOutcomeNudges} now={now} />

      <KoriAlertsList alerts={briefing.alerts} />

      <KoriDecisionsPreview decisions={briefing.pendingDecisions} now={now} />

      <KoriChatDock />
    </div>
  );
}
