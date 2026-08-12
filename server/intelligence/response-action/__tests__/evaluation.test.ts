// Semantic Response Intelligence v0 — evaluation harness.
//
// A hand-labeled set built from the mission's own worked examples plus
// real (paraphrased/anonymized) Koriaki production conversations
// encountered during this mission's read-only audit
// (tmp/response-action-audit.json — never committed, contains real
// customer content; this file keeps only paraphrased, non-identifying
// versions of the message text itself). Deliberately includes hard cases,
// not just obvious ones — several are genuinely ambiguous on purpose, and
// the assertions below treat "the deterministic layer said INCONCLUSIVE"
// as an acceptable (safe) outcome for those, distinct from a genuine false
// negative.
//
// Doubles as a permanent regression suite: any future change to
// deterministic-classifier.ts that regresses recall or introduces a false
// negative fails this file, not just a one-off report.

import { describe, expect, it } from "vitest";
import { classifyDeterministically } from "../deterministic-classifier";
import type { ActionClassificationEntry, ActionState, ConversationActionContext } from "../types";

type Gold = "REPLY_REQUIRED" | "FOLLOW_UP_REQUIRED" | "WAITING_ON_CUSTOMER" | "NO_ACTION_REQUIRED";

interface LabeledCase {
  id: string;
  gold: Gold;
  /** True for a genuinely hard/ambiguous case where INCONCLUSIVE is an acceptable (safe), non-penalized outcome for the deterministic-only layer. */
  acceptableInconclusive: boolean;
  context: ConversationActionContext;
}

function entry(overrides: Partial<ActionClassificationEntry> & { id: string; direction: "INBOUND" | "OUTBOUND"; content: string }): ActionClassificationEntry {
  return { occurredAt: new Date("2026-08-01T00:00:00Z"), ...overrides };
}

function ctx(entries: ActionClassificationEntry[], structural: Partial<ConversationActionContext["structural"]> = {}): ConversationActionContext {
  const last = entries.at(-1);
  return {
    conversationId: "eval-conv",
    leadId: "eval-lead",
    observedStatus: last?.direction === "INBOUND" ? "NEEDS_REPLY" : "WAITING_ON_CUSTOMER",
    lastEntryDirection: last?.direction ?? "INBOUND",
    lastEntryAt: last?.occurredAt ?? new Date(),
    recentEntries: entries,
    structural: { leadNextAction: null, hasOverdueFollowUp: false, hasPendingFollowUp: false, ...structural },
  };
}

const CASES: LabeledCase[] = [
  // --- Mission's own worked examples ---
  { id: "mission-1-ok-gracias", gold: "NO_ACTION_REQUIRED", acceptableInconclusive: false, context: ctx([entry({ id: "e1", direction: "INBOUND", content: "Ok gracias" })]) },
  { id: "mission-2-perfecto-emoji", gold: "NO_ACTION_REQUIRED", acceptableInconclusive: false, context: ctx([entry({ id: "e1", direction: "INBOUND", content: "Perfecto 👍" })]) },
  {
    id: "mission-3-gracias-question",
    gold: "REPLY_REQUIRED",
    acceptableInconclusive: false,
    context: ctx([entry({ id: "e1", direction: "INBOUND", content: "Gracias, ¿cuánto cuesta el envío?" })]),
  },
  {
    id: "mission-4-self-defer",
    gold: "WAITING_ON_CUSTOMER",
    acceptableInconclusive: false,
    context: ctx([entry({ id: "e1", direction: "INBOUND", content: "Lo reviso y mañana te confirmo" })]),
  },
  {
    id: "mission-5-payment-request",
    gold: "REPLY_REQUIRED",
    acceptableInconclusive: false,
    context: ctx([entry({ id: "e1", direction: "INBOUND", content: "Pásame la cuenta para pagar" })]),
  },
  {
    id: "mission-6-advisor-commitment-then-thanks",
    gold: "FOLLOW_UP_REQUIRED",
    acceptableInconclusive: false,
    context: ctx([
      entry({ id: "e1", direction: "OUTBOUND", content: "En 10 minutos te envío la cotización." }),
      entry({ id: "e2", direction: "INBOUND", content: "Ok gracias" }),
    ]),
  },

  // --- Real (paraphrased) Koriaki examples from this mission's production audit ---
  { id: "real-price-question-en", gold: "REPLY_REQUIRED", acceptableInconclusive: false, context: ctx([entry({ id: "e1", direction: "INBOUND", content: "Can you check the price of a product?" })]) },
  {
    id: "real-price-question-es",
    gold: "REPLY_REQUIRED",
    acceptableInconclusive: false,
    context: ctx([entry({ id: "e1", direction: "INBOUND", content: "Excelente cuáles son los Precios" })]),
  },
  { id: "real-hilux-inquiry", gold: "REPLY_REQUIRED", acceptableInconclusive: false, context: ctx([entry({ id: "e1", direction: "INBOUND", content: "Hola, tengo una Toyota Hilux 2022 y quiero comprar el body kit TRAVO. ¿Cuánto cuesta?" })]) },
  // No question mark at all (common informal WhatsApp Spanish) — a
  // deterministic keyword/punctuation pass can't safely tell this apart
  // from a statement without risking false positives elsewhere (e.g. "no
  // se que hacer" also contains "que"); INCONCLUSIVE here is the honest,
  // intended outcome for the deterministic-only layer.
  { id: "real-location-question", gold: "REPLY_REQUIRED", acceptableInconclusive: true, context: ctx([entry({ id: "e1", direction: "INBOUND", content: "Dónde se ubican" })]) },
  { id: "real-delivery-question", gold: "REPLY_REQUIRED", acceptableInconclusive: false, context: ctx([entry({ id: "e1", direction: "INBOUND", content: "hace envíos a chaclacayo?" })]) },
  // Ambiguous one-word/short fragment replies — genuinely need conversation context (an earlier question) to interpret; INCONCLUSIVE is the honest, safe answer for a deterministic-only pass.
  { id: "real-fragment-del77", gold: "REPLY_REQUIRED", acceptableInconclusive: true, context: ctx([entry({ id: "e1", direction: "INBOUND", content: "Del 77" })]) },
  { id: "real-fragment-provincia", gold: "REPLY_REQUIRED", acceptableInconclusive: true, context: ctx([entry({ id: "e1", direction: "INBOUND", content: "Provincia" })]) },
  { id: "real-no-entiendo", gold: "REPLY_REQUIRED", acceptableInconclusive: true, context: ctx([entry({ id: "e1", direction: "INBOUND", content: "No entiendo" })]) },
  { id: "real-unsupported-media", gold: "WAITING_ON_CUSTOMER", acceptableInconclusive: true, context: ctx([entry({ id: "e1", direction: "INBOUND", content: "[unsupported message type: reaction]" })]) },
  // Off-topic / non-commercial content (the reparented "prueba" thread's later personal chat) — must NOT be confidently resolved either way by the deterministic layer.
  { id: "real-offtopic-1", gold: "NO_ACTION_REQUIRED", acceptableInconclusive: true, context: ctx([entry({ id: "e1", direction: "INBOUND", content: "Que te llevo" })]) },
  { id: "real-offtopic-2", gold: "NO_ACTION_REQUIRED", acceptableInconclusive: true, context: ctx([entry({ id: "e1", direction: "INBOUND", content: "Ya pues maria" })]) },
  // An explicit decline — must NEVER be auto-resolved to NO_ACTION_REQUIRED (a declined sale may still warrant a save-the-sale reply).
  { id: "real-decline", gold: "REPLY_REQUIRED", acceptableInconclusive: true, context: ctx([entry({ id: "e1", direction: "INBOUND", content: "lo lamento pero no quiero" })]) },

  // --- Additional hand-authored hard cases ---
  {
    id: "hard-closing-with-tracked-payment-pending",
    gold: "FOLLOW_UP_REQUIRED",
    acceptableInconclusive: false,
    context: ctx([entry({ id: "e1", direction: "INBOUND", content: "Perfecto, gracias" })], { leadNextAction: "CONFIRM_PAYMENT" }),
  },
  {
    id: "hard-closing-with-overdue-followup",
    gold: "FOLLOW_UP_REQUIRED",
    acceptableInconclusive: false,
    context: ctx([entry({ id: "e1", direction: "INBOUND", content: "Gracias" })], { hasOverdueFollowUp: true, hasPendingFollowUp: true }),
  },
  {
    id: "hard-advisor-promise-then-fulfilled",
    gold: "WAITING_ON_CUSTOMER",
    acceptableInconclusive: false,
    context: ctx([
      entry({ id: "e1", direction: "OUTBOUND", content: "En un momento te paso el precio." }),
      entry({ id: "e2", direction: "INBOUND", content: "Ok" }),
      entry({ id: "e3", direction: "OUTBOUND", content: "El kit TRAVO cuesta S/500, incluye instalación." }),
    ]),
  },
  { id: "hard-compatibility-question", gold: "REPLY_REQUIRED", acceptableInconclusive: false, context: ctx([entry({ id: "e1", direction: "INBOUND", content: "¿Es compatible con una Hilux 2020?" })]) },
  { id: "hard-discount-request", gold: "REPLY_REQUIRED", acceptableInconclusive: false, context: ctx([entry({ id: "e1", direction: "INBOUND", content: "¿Tienen algún descuento?" })]) },
  { id: "hard-buying-signal", gold: "REPLY_REQUIRED", acceptableInconclusive: false, context: ctx([entry({ id: "e1", direction: "INBOUND", content: "Lo quiero, cómo hago para comprarlo" })]) },
  {
    id: "hard-advisor-just-answered-no-promise",
    gold: "WAITING_ON_CUSTOMER",
    acceptableInconclusive: false,
    context: ctx([entry({ id: "e1", direction: "OUTBOUND", content: "Sí, tenemos el kit disponible en stock." })]),
  },
  { id: "hard-vale-closing", gold: "NO_ACTION_REQUIRED", acceptableInconclusive: false, context: ctx([entry({ id: "e1", direction: "INBOUND", content: "Vale, gracias" })]) },
  { id: "hard-genial-closing", gold: "NO_ACTION_REQUIRED", acceptableInconclusive: false, context: ctx([entry({ id: "e1", direction: "INBOUND", content: "Genial" })]) },
];

describe("Semantic Response Intelligence v0 — deterministic-layer evaluation", () => {
  const predictions = CASES.map((c) => ({ case: c, prediction: classifyDeterministically(c.context) }));

  it.each(CASES.map((c) => [c.id, c] as const))("case %s classifies safely", (_id, labeled) => {
    const { prediction } = predictions.find((p) => p.case.id === labeled.id)!;
    if (!prediction.resolved) {
      expect(labeled.acceptableInconclusive).toBe(true);
      return;
    }
    const state = prediction.result!.actionState;
    const isDangerousFalseNegative = (state === "NO_ACTION_REQUIRED" || state === "WAITING_ON_CUSTOMER") && (labeled.gold === "REPLY_REQUIRED" || labeled.gold === "FOLLOW_UP_REQUIRED");
    expect(isDangerousFalseNegative).toBe(false);
  });

  it("reports aggregate metrics — zero dangerous false negatives is the hard requirement", () => {
    let falseNegatives = 0;
    let confidentCorrect = 0;
    let confidentIncorrectNonDangerous = 0;
    let inconclusive = 0;
    let noActionRequiredConfident = 0;
    let noActionRequiredConfidentCorrect = 0;
    const actionableGoldCount = CASES.filter((c) => c.gold === "REPLY_REQUIRED" || c.gold === "FOLLOW_UP_REQUIRED").length;
    let actionableSurfacedConfidently = 0;

    for (const { case: c, prediction } of predictions) {
      if (!prediction.resolved) {
        inconclusive++;
        continue;
      }
      const state = prediction.result!.actionState as ActionState;
      const isActionableGold = c.gold === "REPLY_REQUIRED" || c.gold === "FOLLOW_UP_REQUIRED";
      const saysSafe = state === "NO_ACTION_REQUIRED" || state === "WAITING_ON_CUSTOMER";

      if (isActionableGold && saysSafe) falseNegatives++;
      else if (state === c.gold) confidentCorrect++;
      else confidentIncorrectNonDangerous++;

      if (isActionableGold && (state === "REPLY_REQUIRED" || state === "FOLLOW_UP_REQUIRED")) actionableSurfacedConfidently++;

      if (state === "NO_ACTION_REQUIRED") {
        noActionRequiredConfident++;
        if (c.gold === "NO_ACTION_REQUIRED") noActionRequiredConfidentCorrect++;
      }
    }

    // The one hard requirement: never confidently wave off something actionable.
    expect(falseNegatives).toBe(0);

    // NO_ACTION_REQUIRED precision: every time the deterministic layer
    // confidently says "no action," it must actually be correct — this
    // dataset has 100% precision by construction (no case where a
    // NO_ACTION_REQUIRED call was wrong), which the assertion above
    // already guarantees transitively (a wrong NO_ACTION_REQUIRED call on
    // an actionable gold case IS a false negative and would already have
    // failed).
    const noActionRequiredPrecision = noActionRequiredConfident === 0 ? 1 : noActionRequiredConfidentCorrect / noActionRequiredConfident;
    expect(noActionRequiredPrecision).toBe(1);

    console.log(
      JSON.stringify(
        {
          totalCases: CASES.length,
          falseNegatives,
          confidentCorrect,
          confidentIncorrectNonDangerous,
          inconclusive,
          noActionRequiredPrecision,
          actionableGoldCount,
          actionableSurfacedConfidently,
          actionableRecall: actionableGoldCount === 0 ? 1 : actionableSurfacedConfidently / actionableGoldCount,
        },
        null,
        2,
      ),
    );
  });
});
