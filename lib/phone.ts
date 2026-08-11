// Kori Data Correctness Phase 1D — canonical E.164 phone normalization.
//
// Confirmed against a real production duplicate: "51933517901" (WhatsApp's
// raw digits, no leading "+") and "+51933517901" (manually entered, with
// "+") were stored as two different Lead.phone strings for the same real
// number, because nothing normalized either write path. This module is
// the ONLY place a raw phone input should ever be turned into storage
// format — every write boundary calls one of the two functions below,
// never builds/transforms a phone string by hand.
//
// Deliberately built on libphonenumber-js rather than a hand-rolled regex:
// country-calling-code length varies (1 to 3 digits) and national number
// length varies by country, so "is this string a valid phone number" isn't
// safely answerable with a fixed-width pattern.
//
// IMPORTANT: this module only normalizes NEW writes going forward. It does
// not touch, merge, or deduplicate any existing Lead row — see the
// separate read-only duplicate-audit script for that.

import { parsePhoneNumberWithError } from "libphonenumber-js";

/** Koriaki is a Peru-based business — phone input with no country code (national format, e.g. "933517901") is assumed to be a Peru number. */
export const DEFAULT_PHONE_COUNTRY = "PE";

export class InvalidPhoneNumberError extends Error {
  constructor(input: string) {
    super(`"${input}" is not a valid phone number.`);
    this.name = "InvalidPhoneNumberError";
  }
}

function toValidatedE164(candidate: string, originalInput: string, defaultCountry?: "PE"): string {
  let parsed;
  try {
    parsed = parsePhoneNumberWithError(candidate, defaultCountry);
  } catch {
    throw new InvalidPhoneNumberError(originalInput);
  }
  if (!parsed.isValid()) {
    throw new InvalidPhoneNumberError(originalInput);
  }
  return parsed.number; // libphonenumber-js's own E.164 serialization, e.g. "+51933517901"
}

/**
 * For human-entered phone numbers — manual lead creation and any UI field
 * reusing lib/validations/lead.ts's phone schema (including historical
 * WhatsApp import's phone field, which reuses it directly). Accepts either
 * Peru national format ("933517901") or full international format
 * ("+51933517901", "+1 631 555 1234", etc.) — a leading "+" always takes
 * priority over the Peru default. Throws InvalidPhoneNumberError for
 * anything unparseable.
 */
export function normalizePhoneToE164(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new InvalidPhoneNumberError(input);
  return toValidatedE164(trimmed, input, DEFAULT_PHONE_COUNTRY);
}

/**
 * For WhatsApp Cloud API phone digits (Meta's wa_id / message.from /
 * message.to fields) — ALWAYS the full international number as bare
 * digits with NO leading "+" (e.g. "51933517901" for a Peru number), never
 * a bare national number the way a human might type one. Prepends "+"
 * before parsing; never applies the Peru default (the digits already
 * unambiguously encode their own country code). Throws
 * InvalidPhoneNumberError for anything unparseable.
 */
export function normalizeWhatsAppPhoneToE164(rawDigits: string): string {
  const trimmed = rawDigits.trim();
  if (!trimmed) throw new InvalidPhoneNumberError(rawDigits);
  const withPlus = trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
  return toValidatedE164(withPlus, rawDigits);
}

/**
 * Backward-compatibility transition measure: given an already-normalized
 * canonical E.164 phone (e.g. "+51933517901"), returns the small, explicit
 * set of representations an EXISTING Lead row might still be stored under
 * from before this normalization existed — the canonical value itself,
 * plus the exact same digits with no leading "+" (every write path before
 * Phase 1D used that format, or a human-typed "+"-prefixed one, with no
 * transformation applied). Exact-string candidates only — never a fuzzy,
 * partial, or suffix match, and never more than this fixed, deterministic
 * pair. Does not re-validate or re-parse `canonicalE164`; the caller
 * (normalizePhoneToE164 / normalizeWhatsAppPhoneToE164) already did that.
 *
 * Deliberately does NOT also include the bare national-significant-number
 * (e.g. "933517901", no country code) as a third candidate: unlike the
 * two included here, there's no way to confirm it was actually ever
 * accepted by a real write path rather than just theoretically possible
 * under the old, unenforced regex — out of scope for this transition fix.
 */
export function buildLegacyPhoneLookupCandidates(canonicalE164: string): string[] {
  const withoutLeadingPlus = canonicalE164.startsWith("+") ? canonicalE164.slice(1) : canonicalE164;
  return canonicalE164 === withoutLeadingPlus ? [canonicalE164] : [canonicalE164, withoutLeadingPlus];
}
