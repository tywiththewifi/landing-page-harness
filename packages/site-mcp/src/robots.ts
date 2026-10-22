/**
 * Minimal robots.txt support: the group for our user agent (or `*`),
 * Allow/Disallow with `*` and `$` wildcards, longest match wins, plus
 * Crawl-delay and Sitemap lines.
 */
export interface Robots {
  allows(path: string): boolean;
  crawlDelayMs?: number;
  sitemaps: string[];
}

interface Rule {
  allow: boolean;
  pattern: string;
}

export function parseRobots(text: string, userAgent: string): Robots {
  const ua = userAgent.toLowerCase();
  const groups: { agents: string[]; rules: Rule[]; delay?: number }[] = [];
  const sitemaps: string[] = [];
  let current: (typeof groups)[number] | undefined;
  let lastWasAgent = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "sitemap") {
      sitemaps.push(value);
      continue;
    }
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
    } else if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n)) current.delay = n;
    }
  }

  const product = ua.split("/")[0]!;
  const group =
    groups.find((g) => g.agents.some((a) => a !== "*" && product.includes(a))) ??
    groups.find((g) => g.agents.includes("*"));
  const rules = group?.rules ?? [];

  return {
    sitemaps,
    crawlDelayMs: group?.delay !== undefined ? group.delay * 1000 : undefined,
    allows(path) {
      let best: Rule | undefined;
      for (const rule of rules) {
        if (!matches(rule.pattern, path)) continue;
        if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) {
          best = rule;
        }
      }
      return best ? best.allow : true;
    },
  };
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}
