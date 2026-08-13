import { describe, expect, it } from "vitest";
import { bucketForResponseMinutes, computeFirstResponseMinutes } from "../response-time";

describe("computeFirstResponseMinutes", () => {
  it("returns the minutes between the first inbound message and the first outbound reply after it", () => {
    const entries = [
      { direction: "INBOUND" as const, occurredAt: new Date("2026-08-01T10:00:00.000Z") },
      { direction: "OUTBOUND" as const, occurredAt: new Date("2026-08-01T10:20:00.000Z") },
    ];
    expect(computeFirstResponseMinutes(entries)).toBe(20);
  });

  it("ignores entries out of chronological order in the input array", () => {
    const entries = [
      { direction: "OUTBOUND" as const, occurredAt: new Date("2026-08-01T10:20:00.000Z") },
      { direction: "INBOUND" as const, occurredAt: new Date("2026-08-01T10:00:00.000Z") },
    ];
    expect(computeFirstResponseMinutes(entries)).toBe(20);
  });

  it("returns null when there is no inbound message at all", () => {
    const entries = [{ direction: "OUTBOUND" as const, occurredAt: new Date("2026-08-01T10:00:00.000Z") }];
    expect(computeFirstResponseMinutes(entries)).toBeNull();
  });

  it("returns null when no outbound reply has followed the first inbound message yet", () => {
    const entries = [{ direction: "INBOUND" as const, occurredAt: new Date("2026-08-01T10:00:00.000Z") }];
    expect(computeFirstResponseMinutes(entries)).toBeNull();
  });

  it("ignores an outbound message that occurs before the first inbound message", () => {
    const entries = [
      { direction: "OUTBOUND" as const, occurredAt: new Date("2026-08-01T09:00:00.000Z") },
      { direction: "INBOUND" as const, occurredAt: new Date("2026-08-01T10:00:00.000Z") },
      { direction: "OUTBOUND" as const, occurredAt: new Date("2026-08-01T10:10:00.000Z") },
    ];
    expect(computeFirstResponseMinutes(entries)).toBe(10);
  });

  it("uses the FIRST inbound message, not a later one, when several precede the reply", () => {
    const entries = [
      { direction: "INBOUND" as const, occurredAt: new Date("2026-08-01T10:00:00.000Z") },
      { direction: "INBOUND" as const, occurredAt: new Date("2026-08-01T10:05:00.000Z") },
      { direction: "OUTBOUND" as const, occurredAt: new Date("2026-08-01T10:15:00.000Z") },
    ];
    expect(computeFirstResponseMinutes(entries)).toBe(15);
  });

  it("returns 0 for an immediate reply at the exact same timestamp", () => {
    const entries = [
      { direction: "INBOUND" as const, occurredAt: new Date("2026-08-01T10:00:00.000Z") },
      { direction: "OUTBOUND" as const, occurredAt: new Date("2026-08-01T10:00:00.000Z") },
    ];
    expect(computeFirstResponseMinutes(entries)).toBe(0);
  });
});

describe("bucketForResponseMinutes", () => {
  it("buckets under 30 minutes", () => {
    expect(bucketForResponseMinutes(0)).toBe("UNDER_30_MIN");
    expect(bucketForResponseMinutes(29.9)).toBe("UNDER_30_MIN");
  });

  it("buckets 30 minutes to 2 hours", () => {
    expect(bucketForResponseMinutes(30)).toBe("30_MIN_TO_2H");
    expect(bucketForResponseMinutes(119)).toBe("30_MIN_TO_2H");
  });

  it("buckets 2 to 24 hours", () => {
    expect(bucketForResponseMinutes(120)).toBe("2H_TO_24H");
    expect(bucketForResponseMinutes(1439)).toBe("2H_TO_24H");
  });

  it("buckets over 24 hours", () => {
    expect(bucketForResponseMinutes(1440)).toBe("OVER_24H");
    expect(bucketForResponseMinutes(100000)).toBe("OVER_24H");
  });
});
