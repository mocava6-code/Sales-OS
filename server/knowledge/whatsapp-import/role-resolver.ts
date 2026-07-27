// Participant-role resolution (Sprint 8 review, item 9) — deterministic
// identity match first, then (only for an unambiguous 1:1 chat) a single
// post-parse question, otherwise UNKNOWN. Never a guess. This is metadata
// resolution about who's who, not manual knowledge entry.

function normalizeLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .trim();
}

/** Mirrors the Prisma ImportedConversationResolutionMethod enum's values. */
export type ParticipantResolutionOutcome =
  | { method: "DETERMINISTIC_USER_MATCH"; businessSenderLabel: string }
  | { method: "MANUAL_PROMPT"; businessSenderLabel: string }
  | { method: "UNRESOLVED"; businessSenderLabel: null };

export type ParticipantResolutionResult =
  | ({ needsInput: false } & ParticipantResolutionOutcome)
  /** Exactly a 1:1 chat, no deterministic match, and no answer supplied yet — the caller must ask "which participant is Koriaki?" and re-invoke with `manualAnswer`. */
  | { needsInput: true; candidateLabels: [string, string] };

/**
 * `knownBusinessNames` are the business's own User.name values — matched
 * against participant labels first, before ever falling back to asking a
 * question. A match requires the normalized label to equal, or share a
 * whole word (>= 3 chars) with, a known name — loose enough to catch
 * "María" matching a contact saved as "María López (Koriaki)", strict
 * enough not to match on a single shared short substring.
 *
 * `manualAnswer`, when supplied, must be one of `participantLabels` — the
 * OWNER's answer to a previously-required prompt, re-applied on a second
 * call rather than re-asking.
 */
export function resolveParticipantRoles(
  participantLabels: string[],
  knownBusinessNames: string[],
  manualAnswer?: string,
): ParticipantResolutionResult {
  if (manualAnswer && participantLabels.includes(manualAnswer)) {
    return { needsInput: false, method: "MANUAL_PROMPT", businessSenderLabel: manualAnswer };
  }

  const normalizedKnown = knownBusinessNames.map(normalizeLabel).filter(Boolean);
  for (const label of participantLabels) {
    const normalizedLabel = normalizeLabel(label);
    const labelWords = normalizedLabel.split(/\s+/);
    const isMatch = normalizedKnown.some(
      (known) => normalizedLabel === known || labelWords.some((w) => w.length >= 3 && known.split(/\s+/).includes(w)),
    );
    if (isMatch) {
      return { needsInput: false, method: "DETERMINISTIC_USER_MATCH", businessSenderLabel: label };
    }
  }

  if (participantLabels.length === 2) {
    return { needsInput: true, candidateLabels: [participantLabels[0], participantLabels[1]] };
  }

  return { needsInput: false, method: "UNRESOLVED", businessSenderLabel: null };
}

export type MessageRole = "BUSINESS" | "CUSTOMER" | "UNKNOWN";

/**
 * Only ever produces BUSINESS/CUSTOMER for a resolved 2-participant chat —
 * anything else (group chats, unresolved prompts) stays UNKNOWN for every
 * message, never guessed.
 */
export function roleForSender(senderLabel: string, businessSenderLabel: string | null, participantCount: number): MessageRole {
  if (!businessSenderLabel || participantCount !== 2) return "UNKNOWN";
  return senderLabel === businessSenderLabel ? "BUSINESS" : "CUSTOMER";
}
