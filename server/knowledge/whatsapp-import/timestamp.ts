// Parses one WhatsApp export line's raw date/time strings into a UTC Date,
// under an explicit, import-level dateOrder/timezone configuration — never
// inferred independently per message (Sprint 8 review, item 1). A line that
// doesn't parse cleanly returns { date: null, reason }; callers must
// preserve that null, never substitute a guessed date.

export type ImportDateOrder = "DMY" | "MDY";

import { zonedWallClockToUtc } from "./timezone";

export interface ParsedTimestampResult {
  date: Date | null;
  reason?: string;
}

function parseDateParts(dateRaw: string, dateOrder: ImportDateOrder): { year: number; month: number; day: number } | null {
  const segments = dateRaw.split("/").map((segment) => segment.trim());
  if (segments.length !== 3) return null;

  const numbers = segments.map((segment) => Number.parseInt(segment, 10));
  if (numbers.some((n) => Number.isNaN(n))) return null;

  const [a, b, c] = numbers;
  let day: number;
  let month: number;
  let year: number;
  if (dateOrder === "DMY") {
    [day, month, year] = [a, b, c];
  } else {
    [month, day, year] = [a, b, c];
  }
  if (year < 100) year += 2000;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function parseTimeParts(timeRaw: string): { hour: number; minute: number; second: number } | null {
  // WhatsApp exports sometimes use a narrow no-break space (U+202F) or
  // regular space before "a. m."/"p. m." — normalized by the tokenizer
  // before this function ever sees the string, but tolerated here too.
  const cleaned = timeRaw.replace(/\s+/g, " ").trim().toLowerCase();
  const meridiemMatch = cleaned.match(/(a\.?\s?m\.?|p\.?\s?m\.?)\s*$/);
  const isPm = !!meridiemMatch && meridiemMatch[1].startsWith("p");
  const isAm = !!meridiemMatch && meridiemMatch[1].startsWith("a");
  const timePart = meridiemMatch ? cleaned.slice(0, meridiemMatch.index).trim() : cleaned;

  const match = timePart.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  let hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  const second = match[3] ? Number.parseInt(match[3], 10) : 0;

  if (isPm && hour < 12) hour += 12;
  if (isAm && hour === 12) hour = 0;
  if (hour > 23 || minute > 59 || second > 59) return null;

  return { hour, minute, second };
}

export function parseWhatsAppTimestamp(
  dateRaw: string,
  timeRaw: string,
  dateOrder: ImportDateOrder,
  timezone: string,
): ParsedTimestampResult {
  const dateParts = parseDateParts(dateRaw, dateOrder);
  if (!dateParts) {
    return { date: null, reason: `Unparseable date "${dateRaw}" under dateOrder=${dateOrder}.` };
  }

  const timeParts = parseTimeParts(timeRaw);
  if (!timeParts) {
    return { date: null, reason: `Unparseable time "${timeRaw}".` };
  }

  try {
    const date = zonedWallClockToUtc({ ...dateParts, ...timeParts }, timezone);
    return { date };
  } catch (error) {
    return { date: null, reason: `Invalid timezone "${timezone}": ${error instanceof Error ? error.message : String(error)}` };
  }
}
