import { describe, expect, it } from "vitest";
import {
  buildLegacyPhoneLookupCandidates,
  InvalidPhoneNumberError,
  normalizePhoneToE164,
  normalizeStoredPhoneForAudit,
  normalizeWhatsAppPhoneToE164,
} from "../phone";

describe("normalizeWhatsAppPhoneToE164 — Meta's raw digits, no leading '+'", () => {
  it("51933517901 -> +51933517901", () => {
    expect(normalizeWhatsAppPhoneToE164("51933517901")).toBe("+51933517901");
  });

  it("tolerates an already-present leading '+' too", () => {
    expect(normalizeWhatsAppPhoneToE164("+51933517901")).toBe("+51933517901");
  });

  it("rejects an invalid/unparseable number", () => {
    expect(() => normalizeWhatsAppPhoneToE164("123")).toThrow(InvalidPhoneNumberError);
    expect(() => normalizeWhatsAppPhoneToE164("")).toThrow(InvalidPhoneNumberError);
    expect(() => normalizeWhatsAppPhoneToE164("not a phone number")).toThrow(InvalidPhoneNumberError);
  });
});

describe("normalizePhoneToE164 — human-entered input (manual lead creation, historical import)", () => {
  it("+51933517901 -> +51933517901 (already E.164)", () => {
    expect(normalizePhoneToE164("+51933517901")).toBe("+51933517901");
  });

  it("Peru national-format input (no country code, as the current lead form accepts) -> +51933517901", () => {
    expect(normalizePhoneToE164("933517901")).toBe("+51933517901");
  });

  it("tolerates common human formatting (spaces, dashes, parentheses)", () => {
    expect(normalizePhoneToE164("933 517 901")).toBe("+51933517901");
    expect(normalizePhoneToE164("+51 933-517-901")).toBe("+51933517901");
  });

  it("rejects an invalid phone number", () => {
    expect(() => normalizePhoneToE164("123")).toThrow(InvalidPhoneNumberError);
    expect(() => normalizePhoneToE164("")).toThrow(InvalidPhoneNumberError);
    expect(() => normalizePhoneToE164("   ")).toThrow(InvalidPhoneNumberError);
    expect(() => normalizePhoneToE164("not a phone number")).toThrow(InvalidPhoneNumberError);
  });

  it("accepts a full international number for another country when a country code is given explicitly", () => {
    expect(normalizePhoneToE164("+1 202 555 0100")).toBe("+12025550100");
  });
});

describe("normalizePhoneToE164 / normalizeWhatsAppPhoneToE164 — same real number converges to the same canonical string", () => {
  it("a WhatsApp-sourced raw-digit number and a human-typed '+'-prefixed number for the same real phone produce IDENTICAL output", () => {
    // This equivalence is exactly what makes findOrCreateLeadByPhone's
    // exact-string-match reuse the same Lead regardless of which write
    // path (WhatsApp vs. manual entry) resolves a given number first —
    // the real production bug this phase fixes.
    const fromWhatsApp = normalizeWhatsAppPhoneToE164("51933517901");
    const fromManualEntry = normalizePhoneToE164("+51933517901");
    expect(fromWhatsApp).toBe(fromManualEntry);
    expect(fromWhatsApp).toBe("+51933517901");
  });
});

describe("buildLegacyPhoneLookupCandidates — the Phase 1D backward-compatibility transition set", () => {
  it("returns exactly the canonical value and the same digits with no leading '+'", () => {
    expect(buildLegacyPhoneLookupCandidates("+51933517901")).toEqual(["+51933517901", "51933517901"]);
  });

  it("never returns a partial/substring/suffix candidate — only whole-string representations", () => {
    const candidates = buildLegacyPhoneLookupCandidates("+51933517901");
    expect(candidates).not.toContain("933517901"); // bare national number, deliberately excluded
    expect(candidates.every((c) => c.endsWith("933517901"))).toBe(true); // sanity: both are still the same real number
    expect(candidates).toHaveLength(2);
  });

  it("does not duplicate the candidate when the input has no leading '+' already", () => {
    expect(buildLegacyPhoneLookupCandidates("51933517901")).toEqual(["51933517901"]);
  });
});

describe("normalizeStoredPhoneForAudit — Legacy Data Remediation v0, reconciling already-stored rows of unknown origin (READ-ONLY use only)", () => {
  it("WhatsApp raw digits with no leading '+' (already encoding a country code) normalize correctly", () => {
    expect(normalizeStoredPhoneForAudit("51933517901")).toBe("+51933517901");
  });

  it("a foreign (non-Peru) number stored as raw digits with no leading '+' still normalizes — this is exactly what normalizePhoneToE164 gets wrong for stored data", () => {
    expect(normalizeStoredPhoneForAudit("447710173736")).toBe("+447710173736");
  });

  it("already-canonical '+'-prefixed international input normalizes to itself", () => {
    expect(normalizeStoredPhoneForAudit("+51933517901")).toBe("+51933517901");
  });

  it("a bare Peru national number (no country code, no '+') falls back to the Peru default", () => {
    expect(normalizeStoredPhoneForAudit("933517901")).toBe("+51933517901");
  });

  it("the known production duplicate pair converges to the identical canonical string", () => {
    expect(normalizeStoredPhoneForAudit("51933517901")).toBe(normalizeStoredPhoneForAudit("+51933517901"));
  });

  it("rejects a genuinely unparseable/invalid phone", () => {
    expect(() => normalizeStoredPhoneForAudit("not-a-real-phone")).toThrow(InvalidPhoneNumberError);
    expect(() => normalizeStoredPhoneForAudit("123")).toThrow(InvalidPhoneNumberError);
    expect(() => normalizeStoredPhoneForAudit("")).toThrow(InvalidPhoneNumberError);
    expect(() => normalizeStoredPhoneForAudit("   ")).toThrow(InvalidPhoneNumberError);
  });

  it("an already-'+'-prefixed but invalid number is rejected outright, never falls through to the Peru-national interpretation", () => {
    expect(() => normalizeStoredPhoneForAudit("+123")).toThrow(InvalidPhoneNumberError);
  });
});
