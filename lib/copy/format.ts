// es-PE date/time formatting — Sales OS is Spanish-first and Peru-based, so
// every user-facing date/time must go through here instead of a bare
// toLocaleDateString()/toLocaleString() call, which silently follows the
// browser's locale (often English) rather than the product's language.
//
// No monetary/currency fields exist in the schema yet (Lead, Conversation,
// FollowUp, Outcome, etc. carry no amount/currency column) — there's
// nothing to format as PEN today. Add a formatPEN() helper here, scoped to
// the actual currency field, if/when one is introduced.

const TIME_ZONE = "America/Lima";

const dateFormatter = new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", year: "numeric", timeZone: TIME_ZONE });
const dateLongFormatter = new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "long", timeZone: TIME_ZONE });
const timeFormatter = new Intl.DateTimeFormat("es-PE", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TIME_ZONE });
const weekdayFormatter = new Intl.DateTimeFormat("es-PE", { weekday: "long", timeZone: TIME_ZONE });

function isSameLimaDay(a: Date, b: Date): boolean {
  const partsOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(d);
  return partsOf(a) === partsOf(b);
}

function startOfPreviousLimaDay(reference: Date): Date {
  const previous = new Date(reference.getTime() - 24 * 60 * 60 * 1000);
  return previous;
}

/** "12 ago 2026" */
export function formatDate(date: Date): string {
  return dateFormatter.format(date);
}

/** "12 de agosto" — used where the year is implied (e.g. "Expira el 12 de agosto"). */
export function formatDateLong(date: Date): string {
  return dateLongFormatter.format(date);
}

/** "3:42 p. m." */
export function formatTime(date: Date): string {
  return timeFormatter.format(date);
}

/**
 * "Hoy, 3:42 p. m." / "Ayer, 3:42 p. m." / "lunes, 3:42 p. m." (within the
 * last week) / "12 ago 2026, 3:42 p. m." (older) — relative to `now`.
 */
export function formatDateTime(date: Date, now: Date = new Date()): string {
  const time = formatTime(date);
  if (isSameLimaDay(date, now)) return `Hoy, ${time}`;
  if (isSameLimaDay(date, startOfPreviousLimaDay(now))) return `Ayer, ${time}`;
  const daysAgo = Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
  if (daysAgo >= 0 && daysAgo < 7) return `${weekdayFormatter.format(date)}, ${time}`;
  return `${formatDate(date)}, ${time}`;
}

/**
 * "Hace 18 min" / "Hace 2 h" / "Ayer" / "12 ago 2026" — for compact
 * "how long ago" displays (Today's waiting-since column, last-activity
 * timestamps, etc.).
 */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const ms = now.getTime() - date.getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Ahora mismo";
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24 && isSameLimaDay(date, now)) return `Hace ${hours} h`;
  if (isSameLimaDay(date, startOfPreviousLimaDay(now))) return "Ayer";
  const days = Math.floor(hours / 24);
  if (days < 7) return `Hace ${days} d`;
  return formatDate(date);
}
