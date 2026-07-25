import { describe, expect, it } from "vitest";
import { addCalendarDays, getLocalDateParts, isValidIanaTimeZone, zonedTimeToUtc } from "../timezone";

describe("isValidIanaTimeZone", () => {
  it("accepts real IANA zones", () => {
    expect(isValidIanaTimeZone("America/Lima")).toBe(true);
    expect(isValidIanaTimeZone("America/New_York")).toBe(true);
    expect(isValidIanaTimeZone("UTC")).toBe(true);
  });

  it("rejects a bogus zone name", () => {
    expect(isValidIanaTimeZone("Not/AZone")).toBe(false);
  });
});

describe("getLocalDateParts", () => {
  it("reads the correct calendar date/weekday for a fixed-offset zone (America/Lima, UTC-5, no DST)", () => {
    // 2026-07-24T02:00:00Z is still 2026-07-23 21:00 in Lima (UTC-5).
    const parts = getLocalDateParts(new Date("2026-07-24T02:00:00Z"), "America/Lima");
    expect(parts).toEqual({ year: 2026, month: 6, day: 23, weekday: 4 }); // Thursday
  });
});

describe("zonedTimeToUtc", () => {
  it("converts noon in America/Lima (fixed UTC-5) to 17:00 UTC the same day", () => {
    const result = zonedTimeToUtc(2026, 6, 25, 12, 0, "America/Lima");
    expect(result.toISOString()).toBe("2026-07-25T17:00:00.000Z");
  });

  it("is genuinely DST-aware: the same local noon converts differently across a DST boundary (America/New_York)", () => {
    // Mid-July: EDT, UTC-4.
    const summer = zonedTimeToUtc(2026, 6, 15, 12, 0, "America/New_York");
    // Mid-January: EST, UTC-5.
    const winter = zonedTimeToUtc(2026, 0, 15, 12, 0, "America/New_York");

    expect(summer.toISOString()).toBe("2026-07-15T16:00:00.000Z");
    expect(winter.toISOString()).toBe("2026-01-15T17:00:00.000Z");
  });
});

describe("addCalendarDays — calendar-boundary cases", () => {
  it("rolls over a year boundary (Dec 31 + 1 day -> Jan 1 next year)", () => {
    expect(addCalendarDays(2026, 11, 31, 1)).toEqual({ year: 2027, month: 0, day: 1 });
  });

  it("respects leap years (Feb 28 + 1 day -> Feb 29 in a leap year, Mar 1 otherwise)", () => {
    expect(addCalendarDays(2024, 1, 28, 1)).toEqual({ year: 2024, month: 1, day: 29 }); // 2024 is a leap year
    expect(addCalendarDays(2025, 1, 28, 1)).toEqual({ year: 2025, month: 2, day: 1 }); // 2025 is not
  });
});
