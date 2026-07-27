// Minimal robots.txt parser — just enough to respect Disallow rules for a
// bounded same-domain crawl (Sprint 8 Phase 4's politeness requirement).
// Not a full spec implementation (no crawl-delay, no wildcard/$ matching) —
// deliberately conservative: an unparseable or unreachable robots.txt is
// treated as "allow everything" (the common, safe default most crawlers use
// when a site has none), never as "block everything."

export interface RobotsRules {
  disallowedPaths: string[];
}

const USER_AGENT_LINE = /^user-agent:\s*(.*)$/i;
const DISALLOW_LINE = /^disallow:\s*(.*)$/i;

export function parseRobotsTxt(robotsTxt: string): RobotsRules {
  const disallowedPaths: string[] = [];
  let inWildcardBlock = false;

  for (const rawLine of robotsTxt.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const uaMatch = line.match(USER_AGENT_LINE);
    if (uaMatch) {
      inWildcardBlock = uaMatch[1].trim() === "*";
      continue;
    }

    if (!inWildcardBlock) continue;

    const disallowMatch = line.match(DISALLOW_LINE);
    if (disallowMatch && disallowMatch[1].trim().length > 0) {
      disallowedPaths.push(disallowMatch[1].trim());
    }
  }

  return { disallowedPaths };
}

export function isPathAllowed(pathname: string, rules: RobotsRules): boolean {
  return !rules.disallowedPaths.some((disallowed) => pathname.startsWith(disallowed));
}
