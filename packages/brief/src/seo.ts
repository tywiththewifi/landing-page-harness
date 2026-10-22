import type { SeoInsights } from "./schema.ts";

/**
 * A source of keyword and question data. Teams connect whatever they already use
 * (Semrush, Ahrefs, Search Console, an internal tool) behind this interface. With
 * nothing connected, briefs fall back to the best-practice rules below.
 */
export interface SeoProvider {
  id: string;
  name: string;
  description: string;
  research(input: SeoResearchInput): Promise<SeoInsights>;
}

export interface SeoResearchInput {
  /** The marketer's prompt, e.g. "Landing page for our new HubSpot integration". */
  topic: string;
  siteUrl: string;
  lang: string;
}

/** Rules every brief is written and checked against, whichever provider is connected. */
export const SEO_GUIDELINES = [
  "One primary keyword per page, matching what the audience would actually type or ask.",
  "Put the primary keyword in the title, the H1, the meta description and the slug.",
  "Keep the title between 30 and 60 characters and the meta description between 120 and 160.",
  "Use a short, readable slug: lowercase words separated by hyphens.",
  "Answer engines quote direct answers: include at least three real questions with 40 to 60 word answers, and mark them up as FAQPage.",
  "Write headings as plain statements or questions a reader would recognise, not slogans.",
  "Name the product, the company and the category explicitly so answer engines can connect them.",
  "Every number or claim needs a source on the page or a citation.",
];

export const bestPractices: SeoProvider = {
  id: "best-practices",
  name: "Best practices",
  description: "No SEO tool connected. Briefs follow general search and answer-engine guidelines, without volumes.",
  async research() {
    return {
      provider: "best-practices",
      keywords: [],
      questions: [],
      notes: [],
    };
  },
};

/**
 * Connects any tool through one HTTP endpoint. The endpoint receives the research
 * input as JSON and answers with SeoInsights (see docs/seo-providers.md). A small
 * wrapper, Zapier or n8n flow in front of Semrush, Ahrefs or Search Console is enough.
 */
export function httpProvider(opts: {
  id?: string;
  name: string;
  url: string;
  token?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): SeoProvider {
  const doFetch = opts.fetch ?? fetch;
  return {
    id: opts.id ?? "http",
    name: opts.name,
    description: `Keyword data from ${opts.name}.`,
    async research(input) {
      const res = await doFetch(opts.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      });
      if (!res.ok) throw new Error(`${opts.name} answered ${res.status}`);
      return normalizeInsights(await res.json(), opts.id ?? "http");
    },
  };
}

/** Accepts loosely shaped tool output and keeps only what the brief can use. */
export function normalizeInsights(raw: unknown, provider: string): SeoInsights {
  const r = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const keywords = Array.isArray(r.keywords)
    ? r.keywords
        .map((k) => (typeof k === "string" ? { term: k } : (k as Record<string, unknown>)))
        .filter((k) => typeof k.term === "string" && k.term.trim())
        .slice(0, 50)
        .map((k) => ({
          term: String(k.term).trim(),
          volume: num(k.volume),
          difficulty: num(k.difficulty),
          intent: typeof k.intent === "string" ? k.intent : null,
        }))
    : [];
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, 30) : []);
  return { provider, keywords, questions: strings(r.questions), notes: strings(r.notes) };
}

/** Providers available to this server: best practices always, plus one HTTP endpoint if configured. */
export function providersFromEnv(env: Record<string, string | undefined> = process.env): SeoProvider[] {
  const list: SeoProvider[] = [bestPractices];
  if (env.LPH_SEO_ENDPOINT) {
    list.push(httpProvider({ id: "connected", name: env.LPH_SEO_NAME ?? "Connected SEO tool", url: env.LPH_SEO_ENDPOINT, token: env.LPH_SEO_TOKEN }));
  }
  return list;
}
