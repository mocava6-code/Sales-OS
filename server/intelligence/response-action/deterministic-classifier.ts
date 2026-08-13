// Deterministic layer of Semantic Response Intelligence v0 — cheap,
// explainable rules for the cases that don't need AI inference. Reuses the
// Observation Engine's own keyword lists (server/intelligence/observation/
// detectors/keyword-detectors.ts) directly rather than duplicating them;
// adds only the patterns that engine doesn't already have (payment/
// delivery/self-deferral/closing/advisor-commitment), refined against real
// (anonymized) Koriaki production conversations.
//
// PRECEDENCE IS THE WHOLE POINT — checked in this exact order:
//   1. An existing overdue FollowUp, or a structurally-tracked commercial
//      commitment (LeadCommercialProfile.nextAction), always wins over
//      whatever the latest message says. A customer's "ok gracias" must
//      never silently clear a payment/delivery commitment that's tracked
//      elsewhere in the system.
//   2. An explicit, still-unfulfilled advisor promise found in the raw
//      text (checked BEFORE the customer's reply is even read) — "En 10
//      minutos te envío la cotización" / customer: "Ok gracias" must
//      resolve to FOLLOW_UP_REQUIRED, not NO_ACTION_REQUIRED, exactly
//      because the promise, not the acknowledgment, is what's unresolved.
//   3. Only once neither of those applies does the latest message's own
//      content decide anything.
//
// Deliberately does NOT attempt to classify an explicit decline ("no
// quiero") as closed — a customer saying no may still warrant a
// save-the-sale reply, and that judgment needs more context than a
// keyword match can safely provide. See CUSTOMER_DECLINED's doc comment
// in reason-codes.ts. Anything this module can't confidently resolve
// returns `resolved: false` — the caller (classify-conversation-action.ts)
// falls through to the AI layer, never assumes NO_ACTION_REQUIRED.

import {
  COMPATIBILITY_KEYWORDS,
  DISCOUNT_KEYWORDS,
  INSTALLATION_KEYWORDS,
  normalizeContent,
  PHOTO_KEYWORDS,
  PRICE_KEYWORDS,
} from "../observation/detectors/keyword-detectors";
import type { ActionReasonCode } from "./reason-codes";
import type { ActionClassificationEntry, ActionClassificationResult, ConversationActionContext } from "./types";

const DETERMINISTIC_ENGINE_VERSION = "deterministic.1.0.0";

const DELIVERY_REQUEST_KEYWORDS = ["envio", "envios", "entrega", "delivery", "hace envios", "llega a", "mandan a", "envian a", "reparto"] as const;

const PAYMENT_REQUEST_KEYWORDS = [
  "cuenta para pagar",
  "numero de cuenta",
  "número de cuenta",
  "como pago",
  "cómo pago",
  "donde pago",
  "dónde pago",
  "yape",
  "plin",
  "transferencia",
  "pasa la cuenta",
  "pasame la cuenta",
  "pásame la cuenta",
] as const;

const AVAILABILITY_KEYWORDS = ["tienes", "tienen", "hay stock", "disponible", "en stock", "les queda"] as const;

const BUYING_SIGNAL_KEYWORDS = ["lo quiero", "lo llevo", "como hago para comprar", "cómo hago para comprar", "quiero comprarlo", "dame el link de pago", "lo compro"] as const;

/** "mandame tu catalogo" / "envíame tu catálogo" — an imperative catalog request, confirmed against real production traffic; distinct from a general price/availability question. "catalago" is a confirmed real-world typo, not a guess. */
const CATALOG_REQUEST_KEYWORDS = ["catalogo", "catálogo", "catalago"] as const;

/** Short, exact (post-decoration-stripping) closing phrases — deliberately conservative: under-matching leaves a case as inconclusive (safe); over-matching risks a false negative (unsafe). */
const CLOSING_PHRASES = [
  "ok",
  "okay",
  "oka",
  "vale",
  "listo",
  "de acuerdo",
  "esta bien",
  "está bien",
  "gracias",
  "muchas gracias",
  "muchisimas gracias",
  "muchísimas gracias",
  "mil gracias",
  "ok gracias",
  "vale gracias",
  "listo gracias",
  "perfecto",
  "perfecto gracias",
  "genial",
  "genial gracias",
  "excelente",
  "buenisimo",
  "buenísimo",
  "buenazo",
  "todo bien",
  "de nada",
] as const;

const SELF_DEFERRAL_PATTERNS = [
  "lo reviso",
  "lo pienso",
  "lo veo",
  "dejame ver",
  "déjame ver",
  "dejame revisar",
  "déjame revisar",
  "te confirmo",
  "te aviso",
  "te digo",
  "cualquier cosa te aviso",
  "en un rato te digo",
  "mañana te confirmo",
  "manana te confirmo",
  "lo consulto",
  // Formal/"usted" register of the same commitments above — confirmed
  // against real production traffic (a wholesale customer writing "le
  // estoy avisando" / "yo le escribo" / "voy a enviarle" to mean the same
  // thing a retail customer would phrase as "te aviso" / "te escribo").
  "le confirmo",
  "le aviso",
  "le informo",
  "le escribo",
  "le estoy avisando",
  "te estoy avisando",
  "voy a enviarle",
  "cualquier cosa le aviso",
] as const;

const ADVISOR_COMMITMENT_PATTERNS = [
  "te envio",
  "te envío",
  "te paso",
  "te mando",
  "te lo mando",
  "te la mando",
  "en un momento",
  "en unos minutos",
  "en 10 minutos",
  "en 5 minutos",
  "ahorita te",
  "enseguida te",
  "te confirmo",
  "te aviso cuando",
  // Formal/"usted" register mirrors — same commitment, different register.
  "le envio",
  "le envío",
  "le paso",
  "le mando",
  "voy a enviarle",
  "ahorita le",
  "enseguida le",
  "le confirmo",
  "le aviso cuando",
] as const;

/** Emoji-only content (after trimming whitespace) — "👍", "🙏✅", etc. */
const EMOJI_ONLY_PATTERN = /^[\p{Extended_Pictographic}\s]+$/u;

function matchesAny(normalized: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => normalized.includes(keyword));
}

function stripTrailingDecoration(normalized: string): string {
  return normalized
    .replace(/[\p{Extended_Pictographic}]/gu, "")
    .replace(/[!.,¡¿?]+/g, "")
    .trim();
}

/**
 * True if a and b differ by at most one character insertion, deletion, or
 * substitution — a plain two-pointer walk, no DP table needed since we only
 * ever need to know "<=1 or not."
 */
function isWithinEditDistanceOne(a: string, b: string): boolean {
  if (a === b) return true;
  const lengthDiff = a.length - b.length;
  if (lengthDiff < -1 || lengthDiff > 1) return false;

  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) return false;
    if (a.length === b.length) {
      i++;
      j++;
    } else if (a.length > b.length) {
      i++;
    } else {
      j++;
    }
  }
  edits += a.length - i + (b.length - j);
  return edits <= 1;
}

/**
 * Typo tolerance for closing phrases — confirmed against real production
 * traffic ("perfcto" for "perfecto"). Restricted to phrases of at least 6
 * characters: a longer phrase has far fewer real, unrelated words within
 * edit-distance-1 of it, so this stays safe for the same reason the exact
 * match is safe — it still requires the ENTIRE message to be a near-exact
 * match, never a substring/partial one. Short phrases ("ok", "vale",
 * "listo") are deliberately excluded — too easy to collide with an
 * unrelated short word (e.g. "sale" is edit-distance-1 from "vale").
 */
function isCloseToAnyClosingPhrase(stripped: string): boolean {
  return (CLOSING_PHRASES as readonly string[]).some((phrase) => phrase.length >= 6 && isWithinEditDistanceOne(stripped, phrase));
}

function isClosingAcknowledgment(rawContent: string): boolean {
  const normalized = normalizeContent(rawContent).trim();
  if (normalized.length === 0) return false;
  if (EMOJI_ONLY_PATTERN.test(normalized)) return true;
  const stripped = stripTrailingDecoration(normalized);
  if ((CLOSING_PHRASES as readonly string[]).includes(stripped)) return true;
  return isCloseToAnyClosingPhrase(stripped);
}

function isSelfDeferral(normalized: string): boolean {
  return matchesAny(normalized, SELF_DEFERRAL_PATTERNS);
}

/**
 * Ordered most-specific-first — "tienes precio?" should read as a price
 * request, not a generic availability question. Falls back to "any
 * question mark at all" only once every more specific pattern has failed,
 * so an unrecognized-but-clearly-a-question message still resolves to
 * REPLY_REQUIRED instead of falling through to AI/UNCERTAIN unnecessarily.
 */
function detectRequestSignal(normalized: string): ActionReasonCode | null {
  if (matchesAny(normalized, PRICE_KEYWORDS)) return "PRICE_REQUEST";
  if (matchesAny(normalized, PAYMENT_REQUEST_KEYWORDS)) return "PAYMENT_REQUEST";
  if (matchesAny(normalized, DELIVERY_REQUEST_KEYWORDS)) return "DELIVERY_REQUEST";
  if (matchesAny(normalized, COMPATIBILITY_KEYWORDS)) return "COMPATIBILITY_QUESTION";
  if (matchesAny(normalized, INSTALLATION_KEYWORDS)) return "INSTALLATION_QUESTION";
  if (matchesAny(normalized, DISCOUNT_KEYWORDS)) return "DISCOUNT_REQUEST";
  if (matchesAny(normalized, BUYING_SIGNAL_KEYWORDS)) return "BUYING_SIGNAL";
  if (matchesAny(normalized, CATALOG_REQUEST_KEYWORDS)) return "CATALOG_REQUEST";
  if (matchesAny(normalized, AVAILABILITY_KEYWORDS) && normalized.includes("?")) return "PRODUCT_AVAILABILITY";
  if (matchesAny(normalized, PHOTO_KEYWORDS)) return "CUSTOMER_QUESTION";
  if (normalized.includes("?")) return "CUSTOMER_QUESTION";
  return null;
}

function isUnfulfilledAdvisorCommitment(content: string): boolean {
  return matchesAny(normalizeContent(content), ADVISOR_COMMITMENT_PATTERNS);
}

/** The most recent OUTBOUND entry, if any — since it's the most recent one, no later message could have already fulfilled a commitment found here. */
function findUnfulfilledAdvisorCommitment(entries: ActionClassificationEntry[]): ActionClassificationEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].direction === "OUTBOUND") {
      return isUnfulfilledAdvisorCommitment(entries[i].content) ? entries[i] : null;
    }
  }
  return null;
}

export interface DeterministicClassificationResult {
  /** false = inconclusive; the caller must fall through to the AI layer (or UNCERTAIN if AI is unavailable). Never a signal to assume NO_ACTION_REQUIRED. */
  resolved: boolean;
  result?: ActionClassificationResult;
}

function resolved(
  actionState: ActionClassificationResult["actionState"],
  reasonCode: ActionReasonCode,
  confidence: number,
  reasoning: string,
  evidenceEntryIds: string[],
): DeterministicClassificationResult {
  return {
    resolved: true,
    result: { actionState, reasonCode, confidence, reasoning, evidenceEntryIds, recommendedAction: null, source: "DETERMINISTIC" },
  };
}

const INCONCLUSIVE: DeterministicClassificationResult = { resolved: false };

export function classifyDeterministically(context: ConversationActionContext): DeterministicClassificationResult {
  // 1. Structural signals — always checked first, independent of message content.
  if (context.structural.hasOverdueFollowUp) {
    return resolved("FOLLOW_UP_REQUIRED", "FOLLOW_UP_DUE", 0.95, "This lead has an existing follow-up that is now overdue.", []);
  }
  if (context.structural.leadNextAction === "CONFIRM_PAYMENT") {
    return resolved("FOLLOW_UP_REQUIRED", "PAYMENT_CONFIRMATION_PENDING", 0.85, "The lead's commercial profile shows payment was requested and not yet confirmed.", []);
  }
  if (context.structural.leadNextAction === "SCHEDULE_DELIVERY") {
    return resolved("FOLLOW_UP_REQUIRED", "DELIVERY_CONFIRMATION_PENDING", 0.8, "The lead's commercial profile shows delivery details are pending confirmation.", []);
  }

  // 2. An explicit, still-unfulfilled advisor promise — checked before
  // reading the customer's reply, so a closing acknowledgment can never
  // silently clear it.
  const pendingCommitment = findUnfulfilledAdvisorCommitment(context.recentEntries);
  if (pendingCommitment) {
    return resolved(
      "FOLLOW_UP_REQUIRED",
      "ADVISOR_COMMITMENT_PENDING",
      0.75,
      "The advisor's most recent message appears to promise something (e.g. sending a quote) that nothing since confirms was sent.",
      [pendingCommitment.id],
    );
  }

  const lastEntry = context.recentEntries.at(-1);
  if (!lastEntry) return INCONCLUSIVE;

  if (lastEntry.direction === "OUTBOUND") {
    // Advisor spoke last and (per step 2) made no unresolved promise — the ball is in the customer's court.
    return resolved("WAITING_ON_CUSTOMER", "WAITING_FOR_CUSTOMER_DECISION", 0.8, "The advisor has replied and nothing further is owed by them right now.", [lastEntry.id]);
  }

  // lastEntry.direction === "INBOUND"
  const normalized = normalizeContent(lastEntry.content);

  const requestReasonCode = detectRequestSignal(normalized);
  if (requestReasonCode) {
    return resolved("REPLY_REQUIRED", requestReasonCode, 0.85, "The customer's latest message contains a question or request.", [lastEntry.id]);
  }

  if (isSelfDeferral(normalized)) {
    return resolved("WAITING_ON_CUSTOMER", "CUSTOMER_SELF_DEFERRED", 0.75, "The customer indicated they will follow up themselves.", [lastEntry.id]);
  }

  if (isClosingAcknowledgment(lastEntry.content)) {
    return resolved("NO_ACTION_REQUIRED", "CUSTOMER_CLOSING_ACKNOWLEDGEMENT", 0.85, "The customer's latest message is a closing acknowledgment with no open request.", [lastEntry.id]);
  }

  return INCONCLUSIVE;
}

export { DETERMINISTIC_ENGINE_VERSION };
