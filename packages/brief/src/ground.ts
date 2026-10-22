import type { Brand } from "@lph/tokens";

/** Marks text a generator could not know. The consistency check reports every one. */
export const PLACEHOLDER = "[To write]";

/** Everything the site says, as plain strings: titles, descriptions, headings, copy and buttons. */
export function siteText(brand: Brand): string[] {
  return (brand.content ?? []).flatMap((p) => [p.title, p.description, ...p.headings.map((h) => h.text), ...p.paragraphs, ...p.ctas]).filter(Boolean);
}

const NUMBER = /(?:[$€£]\s?)?\d[\d,.]*(?:\s?(?:%|x|\+|k|m|bn)\b|%|\+)?/gi;

/**
 * Numbers worth sourcing: percentages, money, multipliers, "300+" and anything with
 * two or more digits. A bare "3 steps" is left alone.
 */
export function numbersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const raw = m[0].trim().replace(/[.,]$/, "");
    const digits = raw.replace(/[^\d]/g, "");
    if (!digits) continue;
    const marked = /[%$€£+x]|k\b|m\b|bn\b/i.test(raw);
    if (marked || digits.length >= 2) out.push(raw);
  }
  return out;
}

/** The comparable core of a number: "300+" and "300" match, "99.95%" and "99.95 %" match. */
const core = (n: string) => n.replace(/[^\d.]/g, "").replace(/\.$/, "");

export function numberIsSourced(n: string, sources: string[]): boolean {
  const c = core(n);
  return sources.some((s) => numbersIn(s).some((m) => core(m) === c));
}

const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}%$]+/gu, " ").trim();

/** True when the evidence text appears in one of the sources, ignoring case and punctuation. */
export function textIsSourced(evidence: string, sources: string[]): boolean {
  const e = normalize(evidence);
  if (!e) return false;
  return sources.some((s) => normalize(s).includes(e) || (e.length > 30 && e.includes(normalize(s)) && normalize(s).length > 20));
}

export type Casing = "sentence" | "title";

// Short words that Title Case leaves lowercase, so they say nothing about the style.
const MINOR = new Set(["and", "the", "for", "with", "from", "into", "over", "but", "nor", "yet", "via", "per", "our", "your", "you", "are", "not"]);

/** Title Case or Sentence case, judged on the words after the first. Null when there is too little to tell. */
export function casingOf(text: string): Casing | null {
  const words = text
    .split(/\s+/)
    .slice(1)
    .filter((w) => /^\p{L}{3,}/u.test(w) && !MINOR.has(w.toLowerCase()));
  if (words.length < 2) return null;
  const upper = words.filter((w) => /^\p{Lu}/u.test(w) && !/^\p{Lu}{2,}/u.test(w)).length;
  return upper / words.length > 0.6 ? "title" : "sentence";
}

/** The casing most of the site's headings use, or null if they don't agree. */
export function siteCasing(brand: Brand): Casing | null {
  const votes = { sentence: 0, title: 0 };
  for (const p of brand.content ?? []) for (const h of p.headings) {
    const c = casingOf(h.text);
    if (c) votes[c]++;
  }
  const total = votes.sentence + votes.title;
  if (total < 3) return null;
  if (votes.sentence / total >= 0.7) return "sentence";
  if (votes.title / total >= 0.7) return "title";
  return null;
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
