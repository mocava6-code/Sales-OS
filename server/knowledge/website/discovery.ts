// Bounded, same-domain page discovery — sitemap seed + root/BFS discovery +
// canonical dedup (Sprint 8 quality-fix review, item 3). Earlier versions of
// this function returned as soon as a sitemap was found, never running BFS
// at all — meaning any page not listed in the sitemap (an about/services/
// contact page linked only from site navigation, say) could never be
// discovered as long as a sitemap existed. Both sources always run now; the
// result is their canonical-deduped union, still bounded by the same
// maxPages/maxDepth limits and robots rules as before. `fetchFn` is
// injectable so tests never make a real network call, same DI convention
// used throughout this codebase (e.g. server/whatsapp/gateway.ts's
// overridable dependencies).

import * as cheerio from "cheerio";
import { extractPageContent } from "./page-extraction";
import { isPathAllowed, parseRobotsTxt, type RobotsRules } from "./robots";
import { canonicalizeUrl } from "./url-utils";

const DEFAULT_MAX_PAGES = 200;
const DEFAULT_MAX_DEPTH = 4;

export interface DiscoveryDependencies {
  fetchFn?: typeof fetch;
  maxPages?: number;
  maxDepth?: number;
}

export type DiscoveryMethod = "SITEMAP" | "CRAWL" | "SITEMAP_AND_CRAWL";

export interface DiscoveryResult {
  urls: string[];
  method: DiscoveryMethod;
}

async function fetchRobotsRules(origin: string, fetchFn: typeof fetch): Promise<RobotsRules> {
  try {
    const response = await fetchFn(`${origin}/robots.txt`);
    if (!response.ok) return { disallowedPaths: [] };
    return parseRobotsTxt(await response.text());
  } catch {
    return { disallowedPaths: [] };
  }
}

function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

async function discoverFromSitemap(origin: string, fetchFn: typeof fetch, robots: RobotsRules, maxPages: number): Promise<string[] | null> {
  let response: Response;
  try {
    response = await fetchFn(`${origin}/sitemap.xml`);
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const xml = await response.text();
  const $ = cheerio.load(xml, { xmlMode: true });
  const urls: string[] = [];
  $("url > loc, sitemap > loc").each((_, el) => {
    const url = $(el).text().trim();
    if (url && isSameOrigin(url, origin) && isPathAllowed(new URL(url).pathname, robots)) {
      urls.push(url);
    }
  });

  return urls.length > 0 ? urls.slice(0, maxPages) : null;
}

async function discoverByCrawling(
  rootUrl: string,
  origin: string,
  fetchFn: typeof fetch,
  robots: RobotsRules,
  maxPages: number,
  maxDepth: number,
): Promise<string[]> {
  const visited = new Set<string>();
  const results: string[] = [];
  const queue: Array<{ url: string; depth: number }> = [{ url: rootUrl, depth: 0 }];

  while (queue.length > 0 && results.length < maxPages) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    if (!isSameOrigin(url, origin)) continue;
    if (!isPathAllowed(new URL(url).pathname, robots)) continue;

    let html: string;
    try {
      const response = await fetchFn(url);
      if (!response.ok || !(response.headers.get("content-type") ?? "").includes("text/html")) continue;
      html = await response.text();
    } catch {
      continue;
    }

    results.push(url);

    if (depth < maxDepth) {
      const { links } = extractPageContent(html, url);
      for (const href of links) {
        try {
          const resolved = new URL(href, url).toString();
          if (isSameOrigin(resolved, origin) && !visited.has(resolved)) {
            queue.push({ url: resolved, depth: depth + 1 });
          }
        } catch {
          // Unresolvable href (mailto:, javascript:, malformed) — skip.
        }
      }
    }
  }

  return results;
}

export async function discoverPages(rootUrl: string, dependencies: DiscoveryDependencies = {}): Promise<DiscoveryResult> {
  const fetchFn = dependencies.fetchFn ?? fetch;
  const maxPages = dependencies.maxPages ?? DEFAULT_MAX_PAGES;
  const maxDepth = dependencies.maxDepth ?? DEFAULT_MAX_DEPTH;
  const origin = new URL(rootUrl).origin;

  const robots = await fetchRobotsRules(origin, fetchFn);

  // Both sources always run — a sitemap existing is no longer a reason to
  // skip following the site's own links (and vice versa).
  const [sitemapUrls, crawledUrls] = await Promise.all([
    discoverFromSitemap(origin, fetchFn, robots, maxPages),
    discoverByCrawling(rootUrl, origin, fetchFn, robots, maxPages, maxDepth),
  ]);

  const merged = new Map<string, string>(); // canonical -> first-seen original form
  for (const url of [...(sitemapUrls ?? []), ...crawledUrls]) {
    const canonical = canonicalizeUrl(url);
    if (!merged.has(canonical)) merged.set(canonical, url);
  }

  const urls = [...merged.values()].slice(0, maxPages);
  const method: DiscoveryMethod = sitemapUrls && sitemapUrls.length > 0 ? (crawledUrls.length > 0 ? "SITEMAP_AND_CRAWL" : "SITEMAP") : "CRAWL";

  return { urls, method };
}
