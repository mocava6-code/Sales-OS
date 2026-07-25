// Deterministic Spanish relative-date/time extractor for requestedDeliveryAt.
// Anchored to the *message's own* occurredAt (never server "now" at
// extraction time) — re-running this engine days later must still resolve
// "mañana" relative to when it was originally said. Resolved in the
// business's own IANA timezone (server/intelligence/lead-commercial-state/timezone.ts),
// then converted to an absolute UTC Date for storage/DTO processing.
//
// A factory, not a plain FieldExtractor constant: this is the one
// extractor whose behavior genuinely depends on a config value (the
// business's timezone) beyond just the message history, so it's built via
// createRequestedDeliveryAtExtractor(timezone) rather than exported ready-made.

import { normalizeContent } from "../../observation/detectors/keyword-detectors";
import type { FieldCandidate, FieldExtractor, NormalizedMessageForExtraction } from "../types";
import { addCalendarDays, getLocalDateParts, zonedTimeToUtc } from "../timezone";

const RELATIVE_DATE_EXTRACTOR_VERSION = "1.0.0";
const CONFIDENCE = 0.75;

// Order matters: "pasado manana" must be checked before "manana" (which is a substring-adjacent phrase, not a substring, but keeping the check order explicit avoids relying on regex ordering subtleties).
const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"] as const;

type DayExpression =
  | { kind: "today" | "tomorrow" | "day_after_tomorrow" }
  | { kind: "weekday"; weekdayIndex: number };

function parseDayExpression(normalized: string): DayExpression | null {
  if (/\bpasado\s+manana\b/.test(normalized)) return { kind: "day_after_tomorrow" };
  if (/\bmanana\b/.test(normalized)) return { kind: "tomorrow" };
  if (/\bhoy\b/.test(normalized)) return { kind: "today" };

  for (let weekdayIndex = 0; weekdayIndex < WEEKDAY_NAMES.length; weekdayIndex++) {
    if (new RegExp(`\\b${WEEKDAY_NAMES[weekdayIndex]}\\b`).test(normalized)) {
      return { kind: "weekday", weekdayIndex };
    }
  }
  return null;
}

const TIME_PATTERN = /a las\s+(\d{1,2})(?::(\d{2}))?\s*(?:de la\s+(manana|tarde|noche))?/;

/**
 * Ambiguous hours (no am/pm qualifier, not already in 24h form) default to
 * a business-hours-shaped reading: 12 -> noon, 1-6 -> afternoon (PM), 7-11
 * -> morning (AM) as literally stated. A documented default, not a
 * guarantee — a real business may want this configurable later.
 */
function resolveHour24(hourNum: number, meridiem: "AM" | "PM" | null): number {
  if (hourNum >= 13 && hourNum <= 23) return hourNum;
  if (meridiem === "AM") return hourNum === 12 ? 0 : hourNum;
  if (meridiem === "PM") return hourNum === 12 ? 12 : hourNum + 12;
  if (hourNum === 12) return 12;
  if (hourNum >= 1 && hourNum <= 6) return hourNum + 12;
  return hourNum;
}

function parseTimeExpressionMatch(match: RegExpExecArray): { hour: number; minute: number } {
  const hourNum = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const qualifier = match[3] as "manana" | "tarde" | "noche" | undefined;
  const meridiem: "AM" | "PM" | null = qualifier === "manana" ? "AM" : qualifier === "tarde" || qualifier === "noche" ? "PM" : null;

  return { hour: resolveHour24(hourNum, meridiem), minute };
}

function resolveRequestedDeliveryAt(message: NormalizedMessageForExtraction, timezone: string): Date | null {
  const normalized = normalizeContent(message.content);

  // The time match is parsed and *removed* before day-expression parsing
  // runs — "de la mañana" (time-of-day qualifier, "in the morning") would
  // otherwise be misread as standalone "mañana" (tomorrow) by
  // parseDayExpression, since Spanish genuinely uses the same word for
  // both senses and only word order disambiguates them.
  const timeMatch = TIME_PATTERN.exec(normalized);
  const timeExpr = timeMatch ? parseTimeExpressionMatch(timeMatch) : null;
  const remainderForDayParsing = timeMatch
    ? normalized.slice(0, timeMatch.index) + " " + normalized.slice(timeMatch.index + timeMatch[0].length)
    : normalized;

  const dayExpr = parseDayExpression(remainderForDayParsing);
  if (!dayExpr && !timeExpr) return null;

  const anchor = getLocalDateParts(message.occurredAt, timezone);
  let { year, month, day } = anchor;

  if (dayExpr) {
    if (dayExpr.kind === "tomorrow") ({ year, month, day } = addCalendarDays(year, month, day, 1));
    else if (dayExpr.kind === "day_after_tomorrow") ({ year, month, day } = addCalendarDays(year, month, day, 2));
    else if (dayExpr.kind === "weekday") {
      // Strictly the *next* occurrence of that weekday — if today already is
      // that weekday, "el lunes" means next week's Monday, not today.
      const daysUntil = ((dayExpr.weekdayIndex - anchor.weekday + 7) % 7) || 7;
      ({ year, month, day } = addCalendarDays(year, month, day, daysUntil));
    }
    // "today" leaves year/month/day unchanged.
  }

  const { hour, minute } = timeExpr ?? { hour: 12, minute: 0 };
  return zonedTimeToUtc(year, month, day, hour, minute, timezone);
}

export function createRequestedDeliveryAtExtractor(timezone: string): FieldExtractor<Date> {
  return {
    id: "deterministic.requested_delivery_at",
    version: RELATIVE_DATE_EXTRACTOR_VERSION,
    extract(messages: NormalizedMessageForExtraction[]): FieldCandidate<Date>[] {
      const candidates: FieldCandidate<Date>[] = [];

      for (const message of messages) {
        const resolved = resolveRequestedDeliveryAt(message, timezone);
        if (!resolved) continue;

        candidates.push({
          value: resolved,
          confidence: CONFIDENCE,
          conversationId: message.conversationId,
          occurredAt: message.occurredAt,
          evidence: [{ sourceType: "conversation_message", sourceId: message.id, excerpt: message.content }],
          reasoning: `Resolved relative to the message's own timestamp (${message.occurredAt.toISOString()}) in timezone "${timezone}".`,
        });
      }

      return candidates;
    },
  };
}
