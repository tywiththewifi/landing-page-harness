import { PLACEHOLDER, numberIsSourced, numbersIn, siteText, type Brief } from "@lph/brief";
import { applyVariant, findVariant, versionPath, type Page } from "@lph/page";
import type { Brand } from "@lph/tokens";
import type { AdBrief, AdConcept, AdIssue } from "./schema.ts";
import { digitize, isNumberToken, speechTokens } from "./spoken.ts";

/** Everything the gate checks an ad against. Nothing here needs a model. */
export interface GateContext {
  brand: Brand;
  /** The landing page from phase 3. Each ad points at one of its versions. */
  page: Page;
  adBrief: AdBrief;
  /** The page's marketing brief, for the funnel stage and the marketer's original request. */
  brief?: Pick<Brief, "funnelStage" | "prompt">;
}

export interface GateResult {
  pass: boolean;
  issues: AdIssue[];
  /** Estimated spoken length, before anything is voiced. */
  seconds: number;
}

/** Claims a listener takes as fact. Each needs the same words on the site. */
const CLAIMS = /\b(best|#1|number one|no\.\s?1|fastest|cheapest|lowest|guarantee[ds]?|risk[- ]free|award[- ]winning|world'?s|leading|unlimited|forever|top[- ]rated|most popular|trusted by|millions)\b/gi;
/** Words that sound like a different brand. Allowed only if the brand's own site uses them. */
const HYPE = /\b(revolutionary|game[- ]chang(?:ing|er)|insane(?:ly)?|crazy|unbelievable|mind[- ]blowing|skyrocket\w*|explode|massive|epic|amazing|incredible|killer|hurry|act now|don'?t miss (?:out|this)|last chance|once in a lifetime|limited time only)\b/gi;
/** Characters a voice may read aloud or skip: "$2.49/mo" can come out as "slash mo". */
const SYMBOLS = /[/&@#|~^*_=<>\\]|\+(?!\d)|\d\+/g;
const SOFT_CTA = /^(learn more|read more|find out more|discover|explore)\b/i;
const STOP = new Set(["with", "your", "from", "that", "this", "have", "into", "they", "what", "when", "more", "about", "just", "than", "then", "them", "there", "their", "will", "every", "need", "needed"]);

const norm = (s: string) => speechTokens(s).join(" ");
const contentWords = (s: string) => new Set(speechTokens(s).filter((w) => w.length >= 4 && !STOP.has(w) && !isNumberToken(w)));

/** Edit distance, for catching a brand name spelled nearly right. */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

/**
 * Roughly how many words a voice says for a script: digits are expanded, so "$2.49"
 * counts as "two dollars forty-nine" and "85%" as "eighty-five percent".
 */
export function spokenWords(script: string): number {
  return speechTokens(script).reduce((n, t) => {
    if (!isNumberToken(t)) return n + 1;
    const [whole = "", cents] = t.split(".");
    const wholeWords = whole === "0" ? 1 : Math.max(1, Math.ceil(whole.replace(/^0+/, "").length / 1.5));
    return n + wholeWords + (cents ? 3 : 0);
  }, 0);
}

/** The landing page version the ad points at, with the copy and buttons a visitor sees. */
export function landingFor(page: Page, version: string | null) {
  const variant = version ? findVariant(page, version) : null;
  if (version && !variant) return null;
  const view = applyVariant(page, variant);
  const hero = view.blocks.find((b) => b.type === "hero");
  const buttons = view.blocks.flatMap((b) => ("primaryCta" in b ? [b.primaryCta.label, b.secondaryCta.label] : [])).filter((l) => l.trim());
  return { name: variant?.name ?? "General", path: versionPath(page, variant), heading: hero && "heading" in hero ? hero.heading : "", buttons: [...new Set(buttons)] };
}

/**
 * Checks an ad before it's voiced, the way a reviewer would: every number and claim is
 * on the site or in the request, the wording sounds like the brand, it fits the slot,
 * it says the brand's name right, and its call to action is the button on the page it
 * sends people to. Errors block voicing.
 */
export function gateConcept(concept: AdConcept, ctx: GateContext): GateResult {
  const issues: AdIssue[] = [];
  const add = (severity: AdIssue["severity"], rule: string, message: string) => issues.push({ rule, severity, message });
  const { brand, page, adBrief } = ctx;
  const site = siteText(brand);
  const siteNorm = site.map(norm);
  const sources = [...site, adBrief.prompt, ...(ctx.brief?.prompt ? [ctx.brief.prompt] : [])];
  const said = `${concept.headline}\n${concept.script}`;

  // Unfinished
  if ([concept.script, concept.headline, concept.cta].some((t) => t.includes(PLACEHOLDER) || /\[[^\]]*\]|\{\{|TODO|TBD/.test(t))) {
    add("error", "placeholder", "The ad still has text marked to be written.");
  }
  if (!concept.script.trim()) add("error", "script.empty", "The ad has no script.");

  // Length, estimated from the words a voice will say
  const words = spokenWords(concept.script);
  const seconds = Math.round((words / adBrief.wordsPerSecond) * 10) / 10;
  if (seconds > adBrief.seconds.max) add("error", "length.too-long", `About ${seconds} seconds when read (${words} words). The slot is ${adBrief.seconds.min} to ${adBrief.seconds.max} seconds, so cut about ${Math.ceil((seconds - adBrief.seconds.max) * adBrief.wordsPerSecond)} words.`);
  else if (seconds < adBrief.seconds.min) add("warning", "length.too-short", `About ${seconds} seconds when read (${words} words). The slot is ${adBrief.seconds.min} to ${adBrief.seconds.max} seconds.`);

  // Numbers: spelled out or in digits, every one must be sourced
  const flagged = new Set<string>();
  for (const n of numbersIn(digitize(said))) {
    if (flagged.has(n) || numberIsSourced(n, sources.map(digitize))) continue;
    flagged.add(n);
    add("error", "number.unsourced", `"${n}" isn't on ${brand.name}'s site or in the request. Use a number the site states, or remove it.`);
  }

  // Claims a listener takes as fact
  for (const sentence of said.split(/(?<=[.!?])\s+|\n/)) {
    for (const m of sentence.matchAll(CLAIMS)) {
      const after = speechTokens(sentence.slice(m.index)).slice(0, 4);
      const before = speechTokens(sentence.slice(0, m.index)).slice(-2);
      // The claim and the words next to it must appear together on the site, so a site that says
      // "trusted by millions" doesn't source "trusted by every bank".
      const windows = [after.join(" "), [...before, ...after.slice(0, 2)].join(" ")].filter((w) => w.split(" ").length >= 3);
      if (!windows.some((w) => siteNorm.some((s) => ` ${s} `.includes(` ${w} `)))) {
        add("error", "claim.unsourced", `"${sentence.trim()}" claims "${m[0]}", and ${brand.name}'s site doesn't say that. Use the site's own wording or drop the claim.`);
      }
    }
  }

  // Tone: words and shouting the brand doesn't use
  const siteJoined = ` ${siteNorm.join(" ")} `;
  const hype = [...new Set([...said.matchAll(HYPE)].map((m) => m[0].toLowerCase()))].filter((h) => !siteJoined.includes(` ${norm(h)} `));
  if (hype.length) add("error", "tone.hype", `${hype.map((h) => `"${h}"`).join(", ")} ${hype.length === 1 ? "isn't" : "aren't"} how ${brand.name} talks: its site never uses ${hype.length === 1 ? "it" : "them"}.`);
  const siteRaw = site.join(" ");
  const caps = [...new Set(said.match(/\b[A-Z]{3,}\b/g) ?? [])].filter((w) => !new RegExp(`\\b${w}\\b`).test(siteRaw) && w !== brand.name.toUpperCase());
  const shoutedName = said.includes(brand.name.toUpperCase()) && brand.name.toUpperCase() !== brand.name;
  if (caps.length || shoutedName) add("error", "tone.shouting", `Capitals read as shouting, and ${brand.name}'s copy doesn't do it: ${[...caps, ...(shoutedName ? [brand.name.toUpperCase()] : [])].map((w) => `"${w}"`).join(", ")}.`);
  const bangs = (concept.script.match(/!/g) ?? []).length;
  if (bangs && !siteRaw.includes("!")) add("warning", "tone.exclamation", `The script uses ${bangs === 1 ? "an exclamation mark" : `${bangs} exclamation marks`}; ${brand.name}'s site uses none.`);

  // The brand's name, said and spelled right
  const name = brand.name.toLowerCase();
  const tokens = speechTokens(concept.script);
  if (!tokens.includes(name)) add("error", "brand.missing", `The script never says "${brand.name}", so listeners won't know who the ad is for.`);
  const near = [...new Set(speechTokens(said).filter((t) => t !== name && t.length >= 4 && editDistance(t, name) <= Math.max(1, Math.floor(name.length / 4))))];
  if (near.length) add("error", "brand.misspelled", `${near.map((t) => `"${t}"`).join(", ")} looks like a misspelling of "${brand.name}". The voice will read it as written.`);

  // Words the brief rules out, such as competitors
  const avoided = adBrief.avoid.filter((w) => ` ${norm(said)} `.includes(` ${norm(w)} `));
  if (avoided.length) add("error", "words.avoided", `The brief says not to mention ${avoided.map((w) => `"${w}"`).join(", ")}.`);

  // The call to action is said, and it's the button on the page the ad points at
  const cta = concept.cta.trim();
  if (!cta) add("error", "cta.missing", "The ad has no call to action.");
  else if (!` ${norm(concept.script)} `.includes(` ${norm(cta)} `)) add("error", "cta.not-spoken", `The call to action "${cta}" isn't in the script, so listeners never hear it.`);
  const landing = landingFor(page, concept.version);
  if (!landing) add("error", "landing.unknown", `The ad points at a page version "${concept.version}" that doesn't exist. Versions: general${page.variants.map((v) => `, ${v.slug}`).join("")}.`);
  else {
    const ctaWords = new Set(speechTokens(cta));
    if (cta && landing.buttons.length && !landing.buttons.some((b) => speechTokens(b).every((w) => ctaWords.has(w)))) {
      add("error", "cta.not-on-page", `The ad says "${cta}", but the page it sends people to (${landing.path}) offers ${landing.buttons.map((b) => `"${b}"`).join(" and ")}. Say what the button says.`);
    }
    const shared = [...contentWords(concept.headline)].filter((w) => contentWords(landing.heading).has(w));
    if (landing.heading && !shared.length) add("warning", "landing.message-match", `The headline "${concept.headline}" shares no words with the page's heading "${landing.heading}". People who click should land on the promise they heard.`);
  }
  if (ctx.brief?.funnelStage === "decision" && SOFT_CTA.test(cta)) add("warning", "cta.too-soft", `"${cta}" asks too little of people who are ready to decide.`);

  // Things a voice reads badly
  const symbols = [...new Set(concept.script.match(SYMBOLS) ?? [])];
  if (symbols.length) add("warning", "speech.symbols", `The voice may read ${symbols.map((s) => `"${s}"`).join(", ")} aloud or skip it. Write it as words, e.g. "a month" for "/mo".`);

  return { pass: !issues.some((i) => i.severity === "error"), issues, seconds };
}
