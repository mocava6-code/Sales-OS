// Shared URL canonicalization — one definition, used both for page-level
// dedup across sitemap + BFS discovery (discovery.ts) and for root-URL
// dedup across repeated "Sync now" calls (sync-service.ts's
// normalizeRootUrl, which is just this function applied to a root).

const TRACKING_PARAM_PREFIXES = ["utm_", "fbclid", "gclid", "ref"];

export function canonicalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM_PREFIXES.some((prefix) => key.toLowerCase().startsWith(prefix))) {
      url.searchParams.delete(key);
    }
  }
  url.hash = "";

  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  const query = url.searchParams.toString();
  return `${url.origin}${path}${query ? `?${query}` : ""}`;
}
