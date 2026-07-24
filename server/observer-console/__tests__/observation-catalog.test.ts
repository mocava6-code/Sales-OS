import { describe, expect, it } from "vitest";
import { DETECTOR_REGISTRY } from "../detector-registry";
import { listObservationCatalog } from "../observation-catalog";
import { createFakeObservationRepository } from "./fakes";

describe("listObservationCatalog", () => {
  it("reports count and lastSeenAt for observed types, sorted by type", async () => {
    const dependencies = {
      observations: createFakeObservationRepository([], [
        { type: "PRICE_REQUEST", count: 3, lastSeenAt: new Date("2026-07-24T09:00:00Z") },
        { type: "DISCOUNT_NEGOTIATION", count: 1, lastSeenAt: new Date("2026-07-20T09:00:00Z") },
      ]),
    };

    const catalog = await listObservationCatalog("biz-1", dependencies);

    expect(catalog.counts).toEqual([
      { type: "DISCOUNT_NEGOTIATION", count: 1, lastSeenAt: "2026-07-20T09:00:00.000Z" },
      { type: "PRICE_REQUEST", count: 3, lastSeenAt: "2026-07-24T09:00:00.000Z" },
    ]);
  });

  it("lists every ObservationType with zero rows as neverObserved", async () => {
    const dependencies = {
      observations: createFakeObservationRepository([], [
        { type: "PRICE_REQUEST", count: 3, lastSeenAt: new Date("2026-07-24T09:00:00Z") },
      ]),
    };

    const catalog = await listObservationCatalog("biz-1", dependencies);

    const allTypesExceptPriceRequest = Object.keys(DETECTOR_REGISTRY).filter((t) => t !== "PRICE_REQUEST");
    expect(catalog.neverObserved.sort()).toEqual(allTypesExceptPriceRequest.sort());
  });

  it("returns every type as neverObserved when nothing has ever been observed", async () => {
    const dependencies = { observations: createFakeObservationRepository([], []) };

    const catalog = await listObservationCatalog("biz-1", dependencies);

    expect(catalog.counts).toEqual([]);
    expect(catalog.neverObserved.sort()).toEqual(Object.keys(DETECTOR_REGISTRY).sort());
  });
});
