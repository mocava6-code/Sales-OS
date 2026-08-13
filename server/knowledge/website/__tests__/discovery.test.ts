import { describe, expect, it } from "vitest";
import { discoverPages } from "../discovery";

function fakeResponse(body: string, options: { ok?: boolean; contentType?: string } = {}): Response {
  return {
    ok: options.ok ?? true,
    text: async () => body,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? (options.contentType ?? "text/html") : null) },
  } as unknown as Response;
}

function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const handler = routes[url];
    if (!handler) return fakeResponse("", { ok: false });
    return handler();
  }) as typeof fetch;
}

const SITEMAP_XML = `<?xml version="1.0"?><urlset>
  <url><loc>https://koriakiimport.com/</loc></url>
  <url><loc>https://koriakiimport.com/tienda</loc></url>
  <url><loc>https://external-site.com/spam</loc></url>
</urlset>`;

describe("discoverPages — sitemap-first", () => {
  it("uses the sitemap when available, filtering out cross-domain entries", async () => {
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("User-agent: *\n", {}),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse(SITEMAP_XML),
    });

    const result = await discoverPages("https://koriakiimport.com/", { fetchFn });

    expect(result.method).toBe("SITEMAP");
    expect(result.urls).toEqual(["https://koriakiimport.com/", "https://koriakiimport.com/tienda"]);
  });

  it("respects robots.txt Disallow rules even from the sitemap", async () => {
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("User-agent: *\nDisallow: /tienda\n"),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse(SITEMAP_XML),
    });

    const result = await discoverPages("https://koriakiimport.com/", { fetchFn });

    expect(result.urls).toEqual(["https://koriakiimport.com/"]);
  });

  it("caps sitemap results at maxPages", async () => {
    const manyUrlsXml = `<urlset>${Array.from({ length: 10 }, (_, i) => `<url><loc>https://koriakiimport.com/p${i}</loc></url>`).join("")}</urlset>`;
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse(""),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse(manyUrlsXml),
    });

    const result = await discoverPages("https://koriakiimport.com/", { fetchFn, maxPages: 3 });
    expect(result.urls).toHaveLength(3);
  });
});

describe("discoverPages — BFS crawl fallback", () => {
  it("falls back to crawling when no sitemap is available, following same-domain links only", async () => {
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/": () =>
        fakeResponse(`<html><body><main><a href="/tienda">Tienda</a><a href="https://external.com">Externo</a></main></body></html>`),
      "https://koriakiimport.com/tienda": () => fakeResponse(`<html><body><main><p>Kit TRAVO</p></main></body></html>`),
    });

    const result = await discoverPages("https://koriakiimport.com/", { fetchFn });

    expect(result.method).toBe("CRAWL");
    expect(result.urls).toEqual(["https://koriakiimport.com/", "https://koriakiimport.com/tienda"]);
  });

  it("never fetches a cross-domain link", async () => {
    let externalFetched = false;
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/": () => fakeResponse(`<html><body><main><a href="https://external.com/page">x</a></main></body></html>`),
      "https://external.com/page": () => {
        externalFetched = true;
        return fakeResponse("<html></html>");
      },
    });

    await discoverPages("https://koriakiimport.com/", { fetchFn });
    expect(externalFetched).toBe(false);
  });

  it("stops at maxPages during a crawl", async () => {
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/": () =>
        fakeResponse(`<html><body><main><a href="/a">a</a><a href="/b">b</a><a href="/c">c</a></main></body></html>`),
      "https://koriakiimport.com/a": () => fakeResponse("<html><body>a</body></html>"),
      "https://koriakiimport.com/b": () => fakeResponse("<html><body>b</body></html>"),
      "https://koriakiimport.com/c": () => fakeResponse("<html><body>c</body></html>"),
    });

    const result = await discoverPages("https://koriakiimport.com/", { fetchFn, maxPages: 2 });
    expect(result.urls).toHaveLength(2);
  });

  it("does not enqueue further links beyond maxDepth", async () => {
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/": () => fakeResponse(`<html><body><a href="/level1">l1</a></body></html>`),
      "https://koriakiimport.com/level1": () => fakeResponse(`<html><body><a href="/level2">l2</a></body></html>`),
      "https://koriakiimport.com/level2": () => fakeResponse(`<html><body>deep</body></html>`),
    });

    const result = await discoverPages("https://koriakiimport.com/", { fetchFn, maxDepth: 0 });
    expect(result.urls).toEqual(["https://koriakiimport.com/"]);
  });

  it("skips a robots.txt-disallowed path during crawl", async () => {
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("User-agent: *\nDisallow: /admin\n"),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse("", { ok: false }),
      "https://koriakiimport.com/": () => fakeResponse(`<html><body><a href="/admin">admin</a><a href="/tienda">tienda</a></body></html>`),
      "https://koriakiimport.com/tienda": () => fakeResponse(`<html><body>tienda</body></html>`),
    });

    const result = await discoverPages("https://koriakiimport.com/", { fetchFn });
    expect(result.urls).not.toContain("https://koriakiimport.com/admin");
    expect(result.urls).toContain("https://koriakiimport.com/tienda");
  });
});

describe("discoverPages — sitemap seed + BFS discovery + canonical dedup (Sprint 8 quality-fix review, item 3)", () => {
  it("still discovers a page reachable only via a link, even though a sitemap exists — the exact gap the fix closes", async () => {
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("User-agent: *\n"),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse(SITEMAP_XML), // lists only "/" and "/tienda"
      "https://koriakiimport.com/": () =>
        fakeResponse(`<html><body><main><a href="/tienda">Tienda</a><a href="/nosotros">Nosotros</a></main></body></html>`),
      "https://koriakiimport.com/nosotros": () => fakeResponse(`<html><body><main><p>Sobre nosotros</p></main></body></html>`),
      "https://koriakiimport.com/tienda": () => fakeResponse(`<html><body><main><p>Kit TRAVO</p></main></body></html>`),
    });

    const result = await discoverPages("https://koriakiimport.com/", { fetchFn });

    expect(result.method).toBe("SITEMAP_AND_CRAWL");
    expect(result.urls).toContain("https://koriakiimport.com/nosotros"); // never in the sitemap, only linked
    expect(result.urls).toContain("https://koriakiimport.com/tienda");
  });

  it("canonically dedupes a URL discovered by both the sitemap and BFS into one entry", async () => {
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("User-agent: *\n"),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse(SITEMAP_XML), // includes "https://koriakiimport.com/tienda"
      "https://koriakiimport.com/": () => fakeResponse(`<html><body><main><a href="/tienda/">Tienda</a></main></body></html>`), // trailing-slash variant of the same page
      "https://koriakiimport.com/tienda/": () => fakeResponse(`<html><body><main><p>Kit TRAVO</p></main></body></html>`),
    });

    const result = await discoverPages("https://koriakiimport.com/", { fetchFn });

    const tiendaMatches = result.urls.filter((url) => url.replace(/\/$/, "") === "https://koriakiimport.com/tienda");
    expect(tiendaMatches).toHaveLength(1);
  });

  it("reports method SITEMAP_AND_CRAWL even when BFS's results fully overlap the sitemap's — BFS genuinely ran, not skipped", async () => {
    const fetchFn = fakeFetch({
      "https://koriakiimport.com/robots.txt": () => fakeResponse("User-agent: *\n"),
      "https://koriakiimport.com/sitemap.xml": () => fakeResponse(SITEMAP_XML),
      "https://koriakiimport.com/": () => fakeResponse(`<html><body><main><a href="/tienda">Tienda</a></main></body></html>`),
      "https://koriakiimport.com/tienda": () => fakeResponse(`<html><body><main><p>Kit TRAVO</p></main></body></html>`),
    });

    const result = await discoverPages("https://koriakiimport.com/", { fetchFn });
    expect(result.method).toBe("SITEMAP_AND_CRAWL");
  });
});
