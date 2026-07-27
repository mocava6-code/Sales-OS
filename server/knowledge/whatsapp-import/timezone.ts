// Dependency-free local-wall-clock -> UTC conversion for a given IANA
// timezone, using the standard Intl.DateTimeFormat offset trick (no
// date-fns-tz/luxon in package.json — see the Sprint 8 audit). Correct for
// DST-observing zones too, even though the Koriaki/Peru pilot's default
// (America/Lima) never observes DST, since ImportedConversation.timezone is
// operator-configurable, not hardcoded to Lima.

function getTimezoneOffsetMinutes(timeZone: string, instant: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asIfUtc - instant.getTime()) / 60_000;
}

export interface WallClockParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Interprets `parts` as wall-clock time in `timeZone` and returns the
 * corresponding instant. Throws only if `timeZone` isn't a valid IANA
 * identifier — callers are expected to validate that separately, not treat
 * this as per-message error handling.
 */
export function zonedWallClockToUtc(parts: WallClockParts, timeZone: string): Date {
  const naiveUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  // Two-pass: the offset itself can differ slightly around the target
  // instant vs. the naive guess (DST boundaries), so refine once.
  const firstPassOffset = getTimezoneOffsetMinutes(timeZone, new Date(naiveUtc));
  const candidate = naiveUtc - firstPassOffset * 60_000;
  const secondPassOffset = getTimezoneOffsetMinutes(timeZone, new Date(candidate));
  return new Date(naiveUtc - secondPassOffset * 60_000);
}

export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
