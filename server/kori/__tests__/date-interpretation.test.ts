import { describe, expect, it } from "vitest";
import { isKoriDateToken, resolveDateTokensInQueryJson, resolveKoriDateToken } from "../date-interpretation";

// America/Lima is UTC-5 year-round (no DST) — chosen deliberately so expected
// instants below can be hand-verified without timezone-library help.
// `now` = 2026-08-06T15:30:00.000Z = 2026-08-06T10:30:00 local (a Thursday).
const NOW = new Date("2026-08-06T15:30:00.000Z");
const TZ = "America/Lima";

describe("resolveKoriDateToken", () => {
  it.each([
    ["NOW", "2026-08-06T15:30:00.000Z"],
    ["TODAY_START", "2026-08-06T05:00:00.000Z"],
    ["TODAY_END", "2026-08-07T04:59:59.999Z"],
    ["YESTERDAY_START", "2026-08-05T05:00:00.000Z"],
    ["YESTERDAY_END", "2026-08-06T04:59:59.999Z"],
    ["THIS_WEEK_START", "2026-08-03T05:00:00.000Z"],
    ["LAST_WEEK_START", "2026-07-27T05:00:00.000Z"],
    ["LAST_WEEK_END", "2026-08-03T04:59:59.999Z"],
    ["THIS_MONTH_START", "2026-08-01T05:00:00.000Z"],
    ["LAST_MONTH_START", "2026-07-01T05:00:00.000Z"],
    ["LAST_MONTH_END", "2026-08-01T04:59:59.999Z"],
    ["LAST_24_HOURS_START", "2026-08-05T15:30:00.000Z"],
    ["LAST_3_DAYS_START", "2026-08-03T15:30:00.000Z"],
  ] as const)("resolves %s to %s", (token, expectedIso) => {
    expect(resolveKoriDateToken(token, NOW, TZ)).toBe(expectedIso);
  });

  it("rolls LAST_MONTH_START across a year boundary", () => {
    const january = new Date("2026-01-15T15:00:00.000Z");
    expect(resolveKoriDateToken("LAST_MONTH_START", january, TZ)).toBe("2025-12-01T05:00:00.000Z");
  });
});

describe("isKoriDateToken", () => {
  it("recognizes a known token", () => {
    expect(isKoriDateToken("THIS_WEEK_START")).toBe(true);
  });

  it("rejects an unrecognized string, including a raw Spanish phrase or a literal date", () => {
    expect(isKoriDateToken("esta semana")).toBe(false);
    expect(isKoriDateToken("2026-08-06")).toBe(false);
    expect(isKoriDateToken("")).toBe(false);
  });
});

describe("resolveDateTokensInQueryJson", () => {
  it("replaces recognized date tokens inside filters", () => {
    const raw = { operation: "COUNT_LEADS", filters: { createdFrom: "THIS_WEEK_START", needsReply: true } };
    const resolved = resolveDateTokensInQueryJson(raw, NOW, TZ) as { filters: { createdFrom: string; needsReply: boolean } };
    expect(resolved.filters.createdFrom).toBe("2026-08-03T05:00:00.000Z");
    expect(resolved.filters.needsReply).toBe(true);
  });

  it("leaves an already-ISO date string untouched", () => {
    const raw = { operation: "COUNT_LEADS", filters: { createdFrom: "2026-08-01T00:00:00.000Z" } };
    const resolved = resolveDateTokensInQueryJson(raw, NOW, TZ) as { filters: { createdFrom: string } };
    expect(resolved.filters.createdFrom).toBe("2026-08-01T00:00:00.000Z");
  });

  it("leaves an unrecognized (hallucinated) token value untouched, letting schema validation reject it", () => {
    const raw = { operation: "COUNT_LEADS", filters: { createdFrom: "NOT_A_REAL_TOKEN" } };
    const resolved = resolveDateTokensInQueryJson(raw, NOW, TZ) as { filters: { createdFrom: string } };
    expect(resolved.filters.createdFrom).toBe("NOT_A_REAL_TOKEN");
  });

  it("resolves multiple date fields independently", () => {
    const raw = {
      operation: "LIST_LEADS",
      filters: { lastActivityBefore: "LAST_24_HOURS_START", createdFrom: "LAST_WEEK_START", createdTo: "LAST_WEEK_END" },
    };
    const resolved = resolveDateTokensInQueryJson(raw, NOW, TZ) as {
      filters: { lastActivityBefore: string; createdFrom: string; createdTo: string };
    };
    expect(resolved.filters.lastActivityBefore).toBe("2026-08-05T15:30:00.000Z");
    expect(resolved.filters.createdFrom).toBe("2026-07-27T05:00:00.000Z");
    expect(resolved.filters.createdTo).toBe("2026-08-03T04:59:59.999Z");
  });

  it("passes through non-object input unchanged", () => {
    expect(resolveDateTokensInQueryJson(null, NOW, TZ)).toBeNull();
    expect(resolveDateTokensInQueryJson("not an object", NOW, TZ)).toBe("not an object");
    expect(resolveDateTokensInQueryJson([1, 2, 3], NOW, TZ)).toEqual([1, 2, 3]);
  });

  it("passes through an object with no filters unchanged", () => {
    const raw = { operation: "FOLLOW_UP_QUEUE" };
    expect(resolveDateTokensInQueryJson(raw, NOW, TZ)).toEqual(raw);
  });
});
