// Kori Natural Language Parsing v0 — STEP 3 (date interpretation).
//
// Groq is never asked to compute a real date — LLMs are unreliable at date
// arithmetic and don't reliably know "now". Instead, Groq may only choose
// one of these fixed, enumerated tokens as the value of a date filter field
// (createdFrom/createdTo/lastActivityBefore/lastActivityAfter); this module
// deterministically resolves a chosen token to a real ISO instant, anchored
// to a caller-supplied `now` and read through a caller-supplied IANA
// timezone. The LLM proposes the *concept*; this is what canonicalizes it
// into an actual date. Reuses the existing Intl-based timezone arithmetic
// (no date/timezone library dependency in this project) rather than
// reimplementing it.

import { addCalendarDays, getLocalDateParts, zonedTimeToUtc } from "../intelligence/lead-commercial-state/timezone";

export const KORI_DEFAULT_TIMEZONE = "America/Lima";

export const KORI_DATE_TOKENS = [
  "NOW",
  "TODAY_START",
  "TODAY_END",
  "YESTERDAY_START",
  "YESTERDAY_END",
  "THIS_WEEK_START",
  "LAST_WEEK_START",
  "LAST_WEEK_END",
  "THIS_MONTH_START",
  "LAST_MONTH_START",
  "LAST_MONTH_END",
  "LAST_24_HOURS_START",
  "LAST_3_DAYS_START",
] as const;
export type KoriDateToken = (typeof KORI_DATE_TOKENS)[number];

const KORI_DATE_TOKEN_SET: ReadonlySet<string> = new Set(KORI_DATE_TOKENS);

export function isKoriDateToken(value: string): value is KoriDateToken {
  return KORI_DATE_TOKEN_SET.has(value);
}

function startOfLocalDay(year: number, month: number, day: number, timezone: string): Date {
  return zonedTimeToUtc(year, month, day, 0, 0, timezone);
}

/** The instant 1ms before the given local calendar day starts — i.e. 23:59:59.999 the day before, in `timezone`. */
function endOfLocalDayBefore(year: number, month: number, day: number, timezone: string): Date {
  return new Date(startOfLocalDay(year, month, day, timezone).getTime() - 1);
}

// Sun=0..Sat=6 (matches Date.getDay()/getLocalDateParts' convention) -> days since this week's Monday.
function daysSinceMonday(weekday: number): number {
  return (weekday + 6) % 7;
}

/**
 * Resolves one KoriDateToken to an absolute ISO instant. Pure and
 * deterministic given `now`/`timezone` — the only place in the Kori NL
 * pipeline that performs date arithmetic.
 */
export function resolveKoriDateToken(token: KoriDateToken, now: Date, timezone: string): string {
  const local = getLocalDateParts(now, timezone);
  const tomorrow = addCalendarDays(local.year, local.month, local.day, 1);
  const yesterday = addCalendarDays(local.year, local.month, local.day, -1);
  const mondayThisWeek = addCalendarDays(local.year, local.month, local.day, -daysSinceMonday(local.weekday));
  const mondayLastWeek = addCalendarDays(mondayThisWeek.year, mondayThisWeek.month, mondayThisWeek.day, -7);

  switch (token) {
    case "NOW":
      return now.toISOString();
    case "TODAY_START":
      return startOfLocalDay(local.year, local.month, local.day, timezone).toISOString();
    case "TODAY_END":
      return endOfLocalDayBefore(tomorrow.year, tomorrow.month, tomorrow.day, timezone).toISOString();
    case "YESTERDAY_START":
      return startOfLocalDay(yesterday.year, yesterday.month, yesterday.day, timezone).toISOString();
    case "YESTERDAY_END":
      return endOfLocalDayBefore(local.year, local.month, local.day, timezone).toISOString();
    case "THIS_WEEK_START":
      return startOfLocalDay(mondayThisWeek.year, mondayThisWeek.month, mondayThisWeek.day, timezone).toISOString();
    case "LAST_WEEK_START":
      return startOfLocalDay(mondayLastWeek.year, mondayLastWeek.month, mondayLastWeek.day, timezone).toISOString();
    case "LAST_WEEK_END":
      return endOfLocalDayBefore(mondayThisWeek.year, mondayThisWeek.month, mondayThisWeek.day, timezone).toISOString();
    case "THIS_MONTH_START":
      return startOfLocalDay(local.year, local.month, 1, timezone).toISOString();
    case "LAST_MONTH_START": {
      const lastMonthYear = local.month === 0 ? local.year - 1 : local.year;
      const lastMonth = local.month === 0 ? 11 : local.month - 1;
      return startOfLocalDay(lastMonthYear, lastMonth, 1, timezone).toISOString();
    }
    case "LAST_MONTH_END":
      return endOfLocalDayBefore(local.year, local.month, 1, timezone).toISOString();
    case "LAST_24_HOURS_START":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    case "LAST_3_DAYS_START":
      return new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  }
}

const DATE_FILTER_FIELDS = ["createdFrom", "createdTo", "lastActivityBefore", "lastActivityAfter"] as const;

/**
 * Replaces any KoriDateToken values inside `filters.{createdFrom,createdTo,
 * lastActivityBefore,lastActivityAfter}` with their resolved ISO instant.
 * Operates on still-unvalidated JSON (Groq's raw output shape, not yet a
 * KoriQuerySpec) — anything that isn't a recognized token is left
 * untouched, so a genuine ISO string passes through and an invalid/
 * hallucinated value is left to fail parseKoriQuerySpec's own validation
 * rather than being silently accepted here.
 */
export function resolveDateTokensInQueryJson(raw: unknown, now: Date, timezone: string): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return raw;
  }
  const obj = raw as Record<string, unknown>;
  const filters = obj.filters;
  if (typeof filters !== "object" || filters === null || Array.isArray(filters)) {
    return raw;
  }

  const resolvedFilters: Record<string, unknown> = { ...filters };
  for (const field of DATE_FILTER_FIELDS) {
    const value = resolvedFilters[field];
    if (typeof value === "string" && isKoriDateToken(value)) {
      resolvedFilters[field] = resolveKoriDateToken(value, now, timezone);
    }
  }

  return { ...obj, filters: resolvedFilters };
}
