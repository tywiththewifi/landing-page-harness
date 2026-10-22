import { PLACEHOLDER, numbersIn, siteCasing, slugify } from "./ground.ts";
import type { BriefGenerator } from "./generator.ts";
import { SECTIONS, type BriefContent, type FunnelStage, type OutlineSection, type SectionType } from "./schema.ts";

const STAGE_HINTS: [FunnelStage, RegExp][] = [
  ["retention", /\b(existing customers?|upgrade|upsell|renew|onboard|adoption|churn|current users?)\b/i],
  ["decision", /\b(pricing|vs\.?|versus|compare|comparison|alternative|switch|migrat\w*|demo|trial|quote|buy)\b/i],
  ["awareness", /\b(launch\w*|announc\w*|introduc\w*|brand|awareness|new category|what is)\b/i],
  ["consideration", /\b(guide|webinar|ebook|report|how to|integration|feature|use case|solution)\b/i],
];

const OUTLINES: Record<FunnelStage, SectionType[]> = {
  awareness: ["hero", "features", "steps", "faq", "cta"],
  consideration: ["hero", "logos", "features", "steps", "testimonial", "faq", "form"],
  decision: ["hero", "comparison", "stats", "testimonial", "faq", "form"],
  retention: ["hero", "features", "steps", "faq", "cta"],
};

const KPI: Record<FunnelStage, string> = {
  awareness: "Engaged visits (scrolled past the hero) from the page",
  consideration: "Leads captured by the page's form",
  decision: "Demo or trial requests from the page",
  retention: "Existing customers who activate the feature from the page",
};

const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…");

/** Splits "a landing page for our new X aimed at Y" into topic "X" and audience "Y". */
export function parsePrompt(prompt: string) {
  const text = prompt.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
  const body = text
    .replace(/^(please\s+)?(create|build|make|write|plan|design|draft|i need|we need|i want|we want)\s+/i, "")
    .replace(/^(a|an|the)\s+/i, "")
    .replace(/^(new\s+)?(landing\s+page|campaign\s+page|campaign|page|microsite)\s+(for|about|on|to promote|promoting)\s+/i, "");
  const [topicPart, audiencePart] = body.split(/\s+(?:aimed at|targeting|targeted at|for)\s+(?=\S)/i, 2);
  const topic = (topicPart ?? body).replace(/^(our|my|the|a|an)\s+/i, "").replace(/^new\s+/i, "").trim() || body;
  return { topic, audience: audiencePart?.trim() ?? null };
}

/**
 * Writes a brief without a model: structure from the funnel stage, messages and proof
 * from the site's own copy, and placeholders where only a person (or a model) could know.
 * Used when no API key is set, and in tests.
 */
export function templateGenerator(): BriefGenerator {
  return {
    name: "template",
    async generate({ prompt, brand, insights }) {
      const { topic, audience } = parsePrompt(prompt);
      const stage = STAGE_HINTS.find(([, re]) => re.test(prompt))?.[0] ?? "consideration";
      const pages = brand.content ?? [];
      const headings = pages.flatMap((p) => p.headings);
      const paragraphs = pages.flatMap((p) => p.paragraphs);
      const ctas = [...new Set(pages.flatMap((p) => p.ctas))];
      const casing = siteCasing(brand) ?? "sentence";
      const head = (s: string) => (casing === "title" ? titleCase(s) : sentence(s));
      const keyword = (insights.keywords[0]?.term ?? topic).toLowerCase();

      const withNumbers = [...headings.map((h) => h.text), ...paragraphs].filter((t) => numbersIn(t).length);
      const proofPoints: BriefContent["proofPoints"] = withNumbers.slice(0, 3).map((t) => ({ claim: t, source: "site", evidence: t }));
      proofPoints.push({
        claim: `A customer result from using ${topic}`,
        source: "needed",
        evidence: "A named customer and a measured before/after, with their permission to publish.",
      });

      const keyMessages = headings
        .filter((h) => h.level <= 2)
        .slice(0, 3)
        .map((h, i) => ({ message: h.text, support: paragraphs[i] ?? PLACEHOLDER }));
      if (!keyMessages.length) keyMessages.push({ message: `${PLACEHOLDER} Why ${topic} matters to the reader`, support: PLACEHOLDER });

      const outline: OutlineSection[] = OUTLINES[stage]
        .filter((t) => t !== "stats" || withNumbers.length >= 2)
        .map((type) => ({
          type,
          heading: type === "hero" ? head(topic) : type === "faq" ? head(`questions about ${keyword}`) : `${PLACEHOLDER} ${type} heading`,
          purpose: SECTIONS[type],
          notes: type === "hero" ? `Lead with the main benefit of ${topic}${audience ? ` for ${audience}` : ""}.` : "",
        }));

      const primaryCta = ctas[0] ?? (stage === "decision" ? "Book a demo" : stage === "awareness" ? "Learn more" : "Get started");
      const description = pages[0]?.description || brand.summary;
      const name = audience ? sentence(audience) : "Primary buyer";

      return {
        title: sentence(topic),
        summary: `A ${stage} page for ${topic}${audience ? `, aimed at ${audience}` : ""}. It reuses ${brand.name}'s existing messages and proof, and leaves the rest for you to fill in.`,
        objective: {
          statement: `Turn visitors interested in ${topic} into ${stage === "awareness" ? "engaged readers" : stage === "retention" ? "active users of it" : "qualified leads"}.`,
          kpi: { metric: KPI[stage], target: "Set a target", timeframe: "First 90 days after launch" },
        },
        personas: [
          {
            name,
            role: audience ? sentence(audience) : PLACEHOLDER,
            context: `${PLACEHOLDER} What they are trying to get done when they find this page.`,
            pains: [PLACEHOLDER],
            motivations: [PLACEHOLDER],
            objections: [PLACEHOLDER],
          },
        ],
        funnelStage: stage,
        channels: [
          { channel: "organic-search", role: `Rank for "${keyword}" and related questions.` },
          { channel: "answer-engines", role: "Be quoted for the FAQ answers." },
          { channel: "email", role: "Announce the page to the existing list." },
        ],
        keyMessages,
        offer: { offer: `${PLACEHOLDER} What the visitor gets from ${topic}`, primaryCta, secondaryCta: ctas[1] ?? "" },
        proofPoints,
        outline,
        seo: {
          primaryKeyword: keyword,
          secondaryKeywords: insights.keywords.slice(1, 6).map((k) => k.term),
          searchIntent: stage === "decision" ? "transactional" : stage === "awareness" ? "informational" : "commercial",
          title: clip(`${sentence(topic)} | ${brand.name}`, 60),
          metaDescription: clip(`${sentence(topic)}: ${description}`, 160),
          slug: slugify(keyword),
          questions: (insights.questions.length ? insights.questions.slice(0, 4) : [`What is ${keyword}?`, `How does ${keyword} work?`, `Who is ${keyword} for?`]).map(
            (question) => ({ question, answer: `${PLACEHOLDER} A direct 40 to 60 word answer.` }),
          ),
          schemaTypes: ["FAQPage"],
        },
        assumptions: [
          "Written without an AI model: set ANTHROPIC_API_KEY on the server for a brief tailored to the request.",
          "Key messages and proof are taken from the current site. Check they fit this page.",
          ...(insights.keywords.length ? [] : ["Validate keywords in your SEO tool."]),
        ],
      };
    },
  };
}
