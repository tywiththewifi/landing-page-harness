import type { Brand } from "@lph/tokens";
import { PLACEHOLDER, casingOf, dataText, numberIsSourced, numbersIn, siteCasing, siteText, textIsSourced } from "./ground.ts";
import type { Brief } from "./schema.ts";

export interface BriefIssue {
  id: string;
  /** error: blocks building the page. warning: fix before publishing. info: worth a look. */
  severity: "error" | "warning" | "info";
  /** Which part of the brief, matching the editor's section ids. */
  section: "objective" | "personas" | "funnel" | "channels" | "messages" | "offer" | "proof" | "outline" | "seo";
  message: string;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const TRANSACTIONAL = /\b(buy|purchase|order|checkout|subscribe now|pay)\b/i;
const SOFT = /^(learn more|read more|find out more|discover|explore)$/i;
const ASKS_FOR_DETAILS = /\b(demo|trial|sign ?up|register|contact|quote|book|talk to|get started|request|apply|download)\b/i;

/**
 * Checks a brief against itself, the brand's site and search best practice. Nothing
 * here needs a model: these are the rules a reviewer would otherwise apply by hand.
 */
export function checkBrief(brief: Brief, brand: Brand): BriefIssue[] {
  const issues: BriefIssue[] = [];
  const add = (severity: BriefIssue["severity"], section: BriefIssue["section"], id: string, message: string) =>
    issues.push({ id: `${section}.${id}`, severity, section, message });

  // Objective
  const { kpi } = brief.objective;
  if (!kpi.metric.trim()) add("error", "objective", "kpi-metric", "Say what the KPI counts.");
  if (!kpi.target.trim() || /^set a target$/i.test(kpi.target.trim())) add("warning", "objective", "kpi-target", "Set a KPI target so the page has a goal to be judged against.");

  // Personas: each becomes its own page variant in the build step.
  if (!brief.personas.length) add("error", "personas", "none", "Add at least one persona.");
  if (brief.personas.length > 4) add("warning", "personas", "too-many", `${brief.personas.length} personas means ${brief.personas.length} page variants. Three or fewer is easier to keep up to date.`);

  if (!brief.channels.length) add("warning", "channels", "none", "Pick at least one channel that will bring people to the page.");
  if (!brief.keyMessages.length) add("error", "messages", "none", "Add at least one key message.");

  // Offer and call to action
  const cta = brief.offer.primaryCta.trim();
  if (!cta) add("error", "offer", "cta-missing", "Add a primary call to action.");
  else if (words(cta) > 5) add("warning", "offer", "cta-length", `"${cta}" is long for a button. Aim for two to four words.`);
  if (brief.funnelStage === "awareness" && TRANSACTIONAL.test(cta)) add("warning", "funnel", "cta-too-hard", `"${cta}" asks a lot of someone who has just heard of you. Awareness pages usually offer something lighter.`);
  if (brief.funnelStage === "decision" && SOFT.test(cta)) add("warning", "funnel", "cta-too-soft", `"${cta}" is a soft ask for a decision-stage page. Offer the demo, trial or quote.`);
  const siteCtas = (brand.content ?? []).flatMap((p) => p.ctas);
  if (cta && siteCtas.length && !siteCtas.some((c) => c.toLowerCase() === cta.toLowerCase())) {
    add("info", "offer", "cta-new", `"${cta}" isn't a button label the site uses today (${[...new Set(siteCtas)].slice(0, 3).map((c) => `"${c}"`).join(", ")}). Fine if it's deliberate.`);
  }

  // Outline
  const types = brief.outline.map((s) => s.type);
  if (types[0] !== "hero") add("error", "outline", "hero-first", "The page has to open with a hero section.");
  if (types.filter((t) => t === "hero").length > 1) add("error", "outline", "one-hero", "Use one hero: it holds the page's only H1.");
  if (cta && ASKS_FOR_DETAILS.test(cta) && !types.includes("form")) add("warning", "outline", "form", `"${cta}" asks for details but there's no form section to collect them.`);
  if (types.includes("testimonial") && !brief.proofPoints.some((p) => p.source !== "needed" && /["“”]/.test(p.evidence))) {
    add("info", "outline", "testimonial-source", "There's a testimonial section but no sourced quote yet.");
  }

  // Grounding: claims need evidence, numbers need a source.
  const site = siteText(brand);
  const data = dataText(brief.siteData);
  const prompt = [brief.prompt];
  for (const [i, p] of brief.proofPoints.entries()) {
    const n = i + 1;
    if (p.source === "needed") add("warning", "proof", `needed-${n}`, `"${p.claim}" needs evidence before it can go on the page: ${p.evidence}`);
    else if (p.source === "site" && !textIsSourced(p.evidence, site)) add("warning", "proof", `site-${n}`, `The evidence for "${p.claim}" wasn't found on the sampled pages.`);
    else if (p.source === "data" && !textIsSourced(p.evidence, data)) add("warning", "proof", `data-${n}`, `The evidence for "${p.claim}" isn't in the site data${brief.siteData?.server ? ` from ${brief.siteData.server.name}` : ""}.`);
    else if (p.source === "prompt" && !textIsSourced(p.evidence, prompt)) add("warning", "proof", `prompt-${n}`, `The evidence for "${p.claim}" isn't in your request.`);
  }
  const sourced = [...site, ...data, ...prompt, ...brief.proofPoints.filter((p) => p.source !== "needed").map((p) => p.evidence)];
  const claims: [BriefIssue["section"], string][] = [
    ...brief.keyMessages.flatMap((m): [BriefIssue["section"], string][] => [["messages", m.message], ["messages", m.support]]),
    ["offer", brief.offer.offer],
    ...brief.proofPoints.filter((p) => p.source !== "needed").map((p): [BriefIssue["section"], string] => ["proof", p.claim]),
    ["seo", brief.seo.title],
    ["seo", brief.seo.metaDescription],
    ...brief.seo.questions.map((q): [BriefIssue["section"], string] => ["seo", q.answer]),
  ];
  const flagged = new Set<string>();
  for (const [section, text] of claims) {
    if (text.startsWith(PLACEHOLDER)) continue;
    for (const num of numbersIn(text)) {
      if (flagged.has(num) || numberIsSourced(num, sourced)) continue;
      flagged.add(num);
      add("warning", section, `number-${flagged.size}`, `"${num}" isn't on the site${brief.siteData?.facts.length ? ", in the site data" : ""} or in your request. Add a source or remove it.`);
    }
  }

  // Unfinished text left by a generator, reported where it is.
  const parts: [BriefIssue["section"], string, unknown][] = [
    ["objective", "Objective", [brief.objective, brief.summary]],
    ["personas", "Personas", brief.personas],
    ["funnel", "Channels", brief.channels],
    ["messages", "Key messages", brief.keyMessages],
    ["offer", "Offer", brief.offer],
    ["proof", "Proof points", brief.proofPoints],
    ["outline", "Page outline", brief.outline],
    ["seo", "SEO", brief.seo],
  ];
  for (const [section, label, value] of parts) {
    const n = JSON.stringify(value).split(PLACEHOLDER).length - 1;
    if (n) add("warning", section, "placeholders", `${label}: ${n} field${n === 1 ? " still needs" : "s still need"} writing (marked ${PLACEHOLDER}).`);
  }

  // Casing: the new page should read like the rest of the site.
  const casing = siteCasing(brand);
  if (casing) {
    const off = brief.outline.filter((s) => !s.heading.startsWith(PLACEHOLDER) && casingOf(s.heading) && casingOf(s.heading) !== casing);
    if (off.length) add("info", "outline", "casing", `The site writes headings in ${casing === "title" ? "Title Case" : "sentence case"}. Check: ${off.map((s) => `"${s.heading}"`).join(", ")}.`);
  }

  issues.push(...checkSeo(brief));
  return issues;
}

/** Search and answer-engine checks. They apply whichever SEO tool is connected. */
export function checkSeo(brief: Brief): BriefIssue[] {
  const issues: BriefIssue[] = [];
  const add = (severity: BriefIssue["severity"], id: string, message: string) => issues.push({ id: `seo.${id}`, severity, section: "seo", message });
  const { seo } = brief;
  const kw = seo.primaryKeyword.trim().toLowerCase();
  const has = (s: string) => !!kw && s.toLowerCase().includes(kw);

  if (!kw) add("error", "keyword", "Choose a primary keyword.");
  if (seo.title.length < 30 || seo.title.length > 60) add("warning", "title-length", `The title is ${seo.title.length} characters. Search results show about 30 to 60.`);
  if (seo.metaDescription.length < 120 || seo.metaDescription.length > 160) add("warning", "meta-length", `The meta description is ${seo.metaDescription.length} characters. Aim for 120 to 160.`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(seo.slug)) add("error", "slug", `"${seo.slug}" isn't a clean slug. Use lowercase words separated by hyphens.`);
  if (kw && !has(seo.title)) add("warning", "keyword-title", `The title doesn't contain "${seo.primaryKeyword}".`);
  if (kw && !has(seo.metaDescription)) add("info", "keyword-meta", `The meta description doesn't contain "${seo.primaryKeyword}".`);
  const hero = brief.outline.find((s) => s.type === "hero");
  if (kw && hero && !has(hero.heading)) add("info", "keyword-h1", `The hero heading (the page's H1) doesn't contain "${seo.primaryKeyword}".`);
  if (seo.secondaryKeywords.length > 8) add("info", "secondary", "More than eight secondary keywords dilutes the page. Keep the closest ones.");

  // Answer engines quote direct answers to real questions.
  const faq = brief.outline.some((s) => s.type === "faq");
  if (seo.questions.length < 3) add("warning", "questions", "Add at least three questions with direct answers so answer engines can quote the page.");
  if (seo.questions.length && !faq) add("warning", "faq-section", "There are questions but no FAQ section in the outline to show them.");
  if (seo.schemaTypes.includes("FAQPage") && !faq) add("error", "faq-schema", "FAQPage markup needs an FAQ section on the page.");
  if (faq && !seo.schemaTypes.includes("FAQPage")) add("info", "faq-markup", "Add FAQPage to the schema types so the FAQ is marked up.");
  const short = seo.questions.filter((q) => !q.answer.startsWith(PLACEHOLDER) && words(q.answer) < 25);
  if (short.length) add("info", "answers", `${short.length} answer${short.length === 1 ? " is" : "s are"} under 25 words. Answer engines favour complete 40 to 60 word answers.`);
  return issues;
}
