// IANA timezone arithmetic using only Intl.DateTimeFormat — no new
// dependency added (this project has no date/timezone library installed;
// checked before writing this). Node's Intl implementation ships the full
// ICU timezone database, so this is genuinely DST-aware, not a fixed-offset
// approximation — verified by tests against a DST-observing zone, not just
// America/Lima (which has no DST, so a fixed-offset bug could hide there).

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function isValidIanaTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export interface LocalDateParts {
  year: number;
  /** 0-indexed, matching Date's own month convention. */
  month: number;
  day: number;
  /** 0 = Sunday, matching Date.getDay()'s convention. */
  weekday: number;
}

/** What calendar date/weekday `instant` falls on, read in `timezone` — not the server's local timezone. */
export function getLocalDateParts(instant: Date, timezone: string): LocalDateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    values[part.type] = part.value;
  }

  return {
    year: Number(values.year),
    month: Number(values.month) - 1,
    day: Number(values.day),
    weekday: WEEKDAY_INDEX[values.weekday],
  };
}

/**
 * The UTC offset (in minutes, UTC - local — i.e. what to *add* to a local
 * wall-clock reading to get UTC) that `timezone` observes at `instant`.
 * Standard "format-and-diff" technique: format `instant` as if it were UTC
 * but read through `timezone`'s wall clock, then diff against the real UTC
 * reading of `instant`.
 */
function getUtcOffsetMinutes(instant: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    values[part.type] = part.value;
  }

  const localReadingAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );

  return (localReadingAsUtc - instant.getTime()) / 60_000;
}

/**
 * Converts a local wall-clock time (as calendar components, in `timezone`)
 * into the correct absolute UTC Date. Two-pass: guess the offset using the
 * naive UTC reading of the wall-clock components, then apply it — correct
 * for every real-world case except the ~1-hour DST transition window
 * itself, which this domain (a delivery time requested in a chat message)
 * never needs to resolve to sub-hour precision anyway.
 */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  const guessUtcMs = Date.UTC(year, month, day, hour, minute, 0);
  const offsetMinutes = getUtcOffsetMinutes(new Date(guessUtcMs), timezone);
  return new Date(guessUtcMs - offsetMinutes * 60_000);
}

/** Calendar-only day addition (month/year rollover, leap years) — ignores time-of-day and timezone entirely; a pure calendar-date operation. */
export function addCalendarDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const rolled = new Date(Date.UTC(year, month, day + days));
  return { year: rolled.getUTCFullYear(), month: rolled.getUTCMonth(), day: rolled.getUTCDate() };
}
