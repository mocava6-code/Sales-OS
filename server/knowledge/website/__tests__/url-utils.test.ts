import { describe, expect, it } from "vitest";
import { canonicalizeUrl } from "../url-utils";

describe("canonicalizeUrl", () => {
  it("strips a trailing slash", () => {
    expect(canonicalizeUrl("https://koriakiimport.com/tienda/")).toBe("https://koriakiimport.com/tienda");
  });

  it("leaves the root path as the bare origin", () => {
    expect(canonicalizeUrl("https://koriakiimport.com/")).toBe("https://koriakiimport.com");
    expect(canonicalizeUrl("https://koriakiimport.com")).toBe("https://koriakiimport.com");
  });

  it("drops the fragment", () => {
    expect(canonicalizeUrl("https://koriakiimport.com/tienda#section")).toBe("https://koriakiimport.com/tienda");
  });

  it("strips tracking query params but keeps meaningful ones", () => {
    expect(canonicalizeUrl("https://koriakiimport.com/tienda?utm_source=fb&color=negro")).toBe(
      "https://koriakiimport.com/tienda?color=negro",
    );
  });

  it("treats two equivalent URLs as the same canonical string", () => {
    const a = canonicalizeUrl("https://koriakiimport.com/tienda/?utm_campaign=x");
    const b = canonicalizeUrl("https://koriakiimport.com/tienda#top");
    expect(a).toBe(b);
  });
});
