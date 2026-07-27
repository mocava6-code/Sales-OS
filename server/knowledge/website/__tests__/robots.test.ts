import { describe, expect, it } from "vitest";
import { isPathAllowed, parseRobotsTxt } from "../robots";

describe("parseRobotsTxt", () => {
  it("collects Disallow rules under the wildcard User-agent block", () => {
    const rules = parseRobotsTxt(["User-agent: *", "Disallow: /admin", "Disallow: /cart"].join("\n"));
    expect(rules.disallowedPaths).toEqual(["/admin", "/cart"]);
  });

  it("ignores rules under a non-wildcard User-agent block", () => {
    const rules = parseRobotsTxt(["User-agent: Googlebot", "Disallow: /private", "User-agent: *", "Disallow: /admin"].join("\n"));
    expect(rules.disallowedPaths).toEqual(["/admin"]);
  });

  it("ignores comments and blank lines", () => {
    const rules = parseRobotsTxt(["# comment", "", "User-agent: *", "# another comment", "Disallow: /admin"].join("\n"));
    expect(rules.disallowedPaths).toEqual(["/admin"]);
  });

  it("ignores an empty Disallow value (allow-all marker)", () => {
    const rules = parseRobotsTxt(["User-agent: *", "Disallow:"].join("\n"));
    expect(rules.disallowedPaths).toEqual([]);
  });

  it("returns no disallowed paths for empty input", () => {
    expect(parseRobotsTxt("").disallowedPaths).toEqual([]);
  });
});

describe("isPathAllowed", () => {
  it("allows a path with no matching Disallow prefix", () => {
    expect(isPathAllowed("/tienda", { disallowedPaths: ["/admin"] })).toBe(true);
  });

  it("disallows a path matching a Disallow prefix", () => {
    expect(isPathAllowed("/admin/settings", { disallowedPaths: ["/admin"] })).toBe(false);
  });

  it("allows everything when there are no rules (no robots.txt, or unparseable)", () => {
    expect(isPathAllowed("/anything", { disallowedPaths: [] })).toBe(true);
  });
});
