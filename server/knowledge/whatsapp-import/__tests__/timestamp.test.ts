import { describe, expect, it } from "vitest";
import { parseWhatsAppTimestamp } from "../timestamp";

describe("parseWhatsAppTimestamp — DMY (Koriaki/Peru default)", () => {
  it("parses a 2-digit-year DD/MM/YY date under America/Lima (UTC-5, no DST)", () => {
    const result = parseWhatsAppTimestamp("27/07/26", "14:05", "DMY", "America/Lima");

    expect(result.date).not.toBeNull();
    // 14:05 Lima (UTC-5) == 19:05 UTC
    expect(result.date!.toISOString()).toBe("2026-07-27T19:05:00.000Z");
  });

  it("parses a 4-digit year", () => {
    const result = parseWhatsAppTimestamp("27/07/2026", "14:05", "DMY", "America/Lima");
    expect(result.date!.toISOString()).toBe("2026-07-27T19:05:00.000Z");
  });

  it("disambiguates day > 12 under DMY as day, not month", () => {
    // 27/07 can only be day=27, month=07 — confirms DMY is actually applied.
    const result = parseWhatsAppTimestamp("27/07/26", "09:00", "DMY", "America/Lima");
    expect(result.date!.getUTCMonth()).toBe(6); // July, 0-indexed
  });

  it("parses Spanish 12h PM correctly", () => {
    const result = parseWhatsAppTimestamp("27/07/26", "2:05 p. m.", "DMY", "America/Lima");
    expect(result.date!.toISOString()).toBe("2026-07-27T19:05:00.000Z");
  });

  it("parses Spanish 12h AM correctly, including 12 a.m. as midnight", () => {
    const result = parseWhatsAppTimestamp("27/07/26", "12:00 a. m.", "DMY", "America/Lima");
    expect(result.date!.toISOString()).toBe("2026-07-27T05:00:00.000Z");
  });

  it("parses 12 p.m. as noon, not midnight", () => {
    const result = parseWhatsAppTimestamp("27/07/26", "12:00 p. m.", "DMY", "America/Lima");
    expect(result.date!.toISOString()).toBe("2026-07-27T17:00:00.000Z");
  });

  it("parses iOS-style time with seconds", () => {
    const result = parseWhatsAppTimestamp("27/07/26", "14:05:32", "DMY", "America/Lima");
    expect(result.date!.toISOString()).toBe("2026-07-27T19:05:32.000Z");
  });
});

describe("parseWhatsAppTimestamp — never fabricates on failure", () => {
  it("returns date: null for an unparseable date", () => {
    const result = parseWhatsAppTimestamp("not-a-date", "14:05", "DMY", "America/Lima");
    expect(result.date).toBeNull();
    expect(result.reason).toBeTruthy();
  });

  it("returns date: null for a day out of range under DMY (e.g. 35/07/26)", () => {
    const result = parseWhatsAppTimestamp("35/07/26", "14:05", "DMY", "America/Lima");
    expect(result.date).toBeNull();
  });

  it("returns date: null for an unparseable time", () => {
    const result = parseWhatsAppTimestamp("27/07/26", "not-a-time", "DMY", "America/Lima");
    expect(result.date).toBeNull();
  });

  it("returns date: null for an out-of-range hour", () => {
    const result = parseWhatsAppTimestamp("27/07/26", "25:00", "DMY", "America/Lima");
    expect(result.date).toBeNull();
  });
});

describe("parseWhatsAppTimestamp — MDY order (non-default, configured explicitly)", () => {
  it("interprets the same raw string differently under MDY vs DMY, per configuration — never inferred", () => {
    const dmy = parseWhatsAppTimestamp("03/04/26", "10:00", "DMY", "America/Lima");
    const mdy = parseWhatsAppTimestamp("03/04/26", "10:00", "MDY", "America/Lima");

    expect(dmy.date!.getUTCMonth()).toBe(3); // April
    expect(mdy.date!.getUTCMonth()).toBe(2); // March
    expect(dmy.date!.getUTCDate()).toBe(3);
    expect(mdy.date!.getUTCDate()).toBe(4);
  });
});
