import { describe, expect, it } from "vitest";
import { fetchKnownBusinessNames } from "../known-business-names";

function fakeDb(businessUserNames: string[], businessName: string | null) {
  return {
    user: { findMany: async () => businessUserNames.map((name) => ({ name })) },
    business: { findUnique: async () => (businessName ? { name: businessName } : null) },
  } as never;
}

describe("fetchKnownBusinessNames", () => {
  it("includes both individual advisor names and the business's own registered name", async () => {
    const names = await fetchKnownBusinessNames("biz-1", fakeDb(["Mosiah Carrasco", "Maria Chaca"], "Koriaki"));
    expect(names.sort()).toEqual(["Koriaki", "Maria Chaca", "Mosiah Carrasco"].sort());
  });

  it("still returns the advisor names when the business has no registered name", async () => {
    const names = await fetchKnownBusinessNames("biz-1", fakeDb(["Mosiah Carrasco"], null));
    expect(names).toEqual(["Mosiah Carrasco"]);
  });

  it("still returns the business name when the business has no users yet", async () => {
    const names = await fetchKnownBusinessNames("biz-1", fakeDb([], "Koriaki"));
    expect(names).toEqual(["Koriaki"]);
  });
});
