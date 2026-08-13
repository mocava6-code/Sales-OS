// Deterministic, regex-based line tokenizer for WhatsApp chat exports — no
// LLM involved anywhere in this file. Handles the two export formats WhatsApp
// actually produces (Android and iOS), Spanish 12h AM/PM markers, multi-line
// messages, and senderless system messages (encryption notice, group
// membership changes). Timestamps are parsed elsewhere (timestamp.ts) — this
// file only splits the raw text into per-message tokens with their raw
// date/time strings intact.

// The trailing `\s?` (not `\s`) after the date/time prefix is deliberate —
// confirmed against a real production export: a line like
// "11/8/2026, 6:11 p. m. -" with genuinely NOTHING after the dash (no
// trailing space, no content — a blank system marker some WhatsApp Business
// exports insert) failed to match when this required a trailing whitespace
// character that doesn't exist at end-of-line, silently merging the line
// into whatever token preceded it instead of becoming its own (empty)
// token. `\s?` still consumes the real separator space in every normal
// "date, time - Sender: content" line exactly as before.
const ANDROID_LINE = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?)\s-\s?([\s\S]*)$/i;
const IOS_LINE = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?)\]\s?([\s\S]*)$/i;

// "Name: message" — WhatsApp's own format for every real message. A colon
// with no leading "Name:" (the encryption notice, group-membership changes,
// etc.) never matches this, which is precisely how those are told apart from
// real messages: structurally, not by keyword-matching every possible
// system-event phrasing.
const SENDER_LINE = /^([^:\n]{1,60}?):\s([\s\S]*)$/;

// Meta auto-inserts this exact marker (Spanish: "Anuncio de Facebook" /
// "Anuncio de Instagram", followed by "Ver detalles" and a canned greeting)
// into a WhatsApp Business export whenever a chat originated from a
// click-to-WhatsApp ad — prefixed with the BUSINESS's own sender label, so
// it structurally looks exactly like a real message the business typed
// (confirmed against a real production export). Nobody at the business
// wrote this text; importing it as a real reply would fabricate a message.
// A narrow, literal prefix match — not a broad keyword filter — since this
// exact phrase is a fixed product string Meta controls, not something a
// real conversation would ever coincidentally start with.
const AD_CONTEXT_MESSAGE = /^anuncio de (facebook|instagram)\b/i;

export function isMetaAdContextMessage(content: string): boolean {
  return AD_CONTEXT_MESSAGE.test(content.trim());
}

/**
 * Invisible/format characters WhatsApp exports are known to embed (left-to-right
 * mark before media placeholders, byte-order mark at the start of the file,
 * narrow no-break space / non-breaking space before "a. m."/"p. m."), plus
 * en/em dash variants some locales use instead of a plain hyphen before the
 * sender. Normalized once, up front, so every downstream regex only has to
 * handle the plain-ASCII shape.
 */
function normalizeRawText(rawText: string): string {
  return rawText
    .replace(/^﻿/, "")
    .replace(/[‎‏]/g, "")
    .replace(/[  ]/g, " ")
    .replace(/[‒–—―]/g, "-")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

export interface TokenizedLine {
  kind: "MESSAGE" | "SYSTEM";
  dateRaw: string;
  timeRaw: string;
  /** Set only for kind: "MESSAGE". */
  senderLabel: string | null;
  content: string;
  /** Original line(s) this token was parsed from, joined by "\n" for multi-line messages — provenance/evidence, never read for parsing. */
  rawLine: string;
}

export function tokenizeWhatsAppExport(rawText: string): TokenizedLine[] {
  const lines = normalizeRawText(rawText).split("\n");
  const tokens: TokenizedLine[] = [];
  let current: TokenizedLine | null = null;

  for (const line of lines) {
    const androidMatch = line.match(ANDROID_LINE);
    const iosMatch = !androidMatch ? line.match(IOS_LINE) : null;
    const match = androidMatch ?? iosMatch;

    if (match) {
      if (current) tokens.push(current);

      const [, dateRaw, timeRaw, remainder] = match;
      const senderMatch = remainder.match(SENDER_LINE);
      current =
        senderMatch && !isMetaAdContextMessage(senderMatch[2])
          ? { kind: "MESSAGE", dateRaw, timeRaw, senderLabel: senderMatch[1].trim(), content: senderMatch[2], rawLine: line }
          : { kind: "SYSTEM", dateRaw, timeRaw, senderLabel: null, content: remainder, rawLine: line };
      continue;
    }

    // No timestamp prefix — a continuation of the previous message (multi-line
    // text, e.g. a pasted list). A stray line before any timestamp has
    // matched yet (shouldn't happen in a valid export) is silently skipped
    // rather than fabricating a token for it.
    if (current) {
      current.content += `\n${line}`;
      current.rawLine += `\n${line}`;
    }
  }
  if (current) tokens.push(current);

  return tokens;
}
