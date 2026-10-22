import type { Page, PageType } from "./types.ts";

export interface Hit {
  url: string;
  path: string;
  type: PageType;
  title: string;
  score: number;
  snippet: string;
}

interface Doc {
  page: Page;
  terms: Map<string, number>;
  length: number;
}

/**
 * BM25 over title, description, headings and body. Title and headings are
 * counted more than once so they outweigh a passing mention in the body.
 * Small enough to rebuild on every start; swap for embeddings when a site
 * has thousands of pages or queries are conceptual rather than keyword.
 */
export class SiteIndex {
  private docs: Doc[];
  private df = new Map<string, number>();
  private avgLength: number;

  constructor(pages: Page[]) {
    this.docs = pages.map((page) => {
      const tokens = [
        ...repeat(tokenize(page.title), 3),
        ...repeat(tokenize(page.description), 2),
        ...repeat(tokenize(page.outline.join(" ")), 2),
        ...tokenize(page.markdown),
      ];
      const terms = new Map<string, number>();
      for (const t of tokens) terms.set(t, (terms.get(t) ?? 0) + 1);
      for (const t of terms.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { page, terms, length: tokens.length };
    });
    this.avgLength = this.docs.reduce((n, d) => n + d.length, 0) / Math.max(1, this.docs.length);
  }

  search(query: string, opts: { type?: PageType; lang?: string; limit?: number } = {}): Hit[] {
    const q = [...new Set(tokenize(query))];
    const N = this.docs.length;
    const k1 = 1.2;
    const b = 0.75;
    const hits: Hit[] = [];
    for (const d of this.docs) {
      if (opts.type && d.page.type !== opts.type) continue;
      if (opts.lang && d.page.lang !== opts.lang) continue;
      let score = 0;
      for (const t of q) {
        const tf = d.terms.get(t);
        if (!tf) continue;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.length) / this.avgLength)));
      }
      if (score > 0) {
        hits.push({ url: d.page.url, path: d.page.path, type: d.page.type, title: d.page.title, score: round(score), snippet: snippet(d.page, q) });
      }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 8);
  }
}

const STOP = new Set("a an and are as at be by for from has have how in is it its of on or that the this to was we what when which who why will with you your".split(" "));

export function tokenize(text: string): string[] {
  return (text.toLowerCase().normalize("NFKD").match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((t) => !STOP.has(t))
    .map(stem);
}

function stem(t: string): string {
  if (t.length > 5 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 4 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

function snippet(page: Page, q: string[]): string {
  const lines = page.markdown.split("\n\n").filter((l) => !l.startsWith("#"));
  let best = page.description;
  let bestScore = 0;
  for (const l of lines) {
    const toks = new Set(tokenize(l));
    const s = q.filter((t) => toks.has(t)).length;
    if (s > bestScore) {
      best = l;
      bestScore = s;
    }
  }
  return best.length > 280 ? best.slice(0, 277) + "..." : best;
}

function repeat<T>(xs: T[], n: number): T[] {
  return Array.from({ length: n }, () => xs).flat();
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
