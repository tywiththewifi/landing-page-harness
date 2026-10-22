import type { Brief } from "./schema.ts";

const list = (items: string[]) => items.filter(Boolean).map((i) => `- ${i}`).join("\n");

/** The brief as Markdown, for people to share and for agents to read before building the page. */
export function briefToMarkdown(b: Brief): string {
  const out: string[] = [
    `# ${b.title}`,
    "",
    b.summary,
    "",
    `> Request: ${b.prompt.replace(/\n+/g, " ")}`,
    "",
    "## Objective",
    "",
    b.objective.statement,
    "",
    `- **KPI:** ${b.objective.kpi.metric}`,
    `- **Target:** ${b.objective.kpi.target}`,
    `- **Timeframe:** ${b.objective.kpi.timeframe}`,
    "",
    "## Personas",
    "",
  ];
  for (const p of b.personas) {
    out.push(`### ${p.name}`, "", `${p.role}. ${p.context}`, "");
    if (p.pains.length) out.push("**Pains**", "", list(p.pains), "");
    if (p.motivations.length) out.push("**Motivations**", "", list(p.motivations), "");
    if (p.objections.length) out.push("**Objections**", "", list(p.objections), "");
  }
  out.push(
    "## Funnel stage",
    "",
    b.funnelStage.charAt(0).toUpperCase() + b.funnelStage.slice(1),
    "",
    "## Channels",
    "",
    list(b.channels.map((c) => `**${c.channel}:** ${c.role}`)),
    "",
    "## Key messages",
    "",
    b.keyMessages.map((m, i) => `${i + 1}. **${m.message}** ${m.support}`).join("\n"),
    "",
    "## Offer and call to action",
    "",
    `- **Offer:** ${b.offer.offer}`,
    `- **Primary CTA:** ${b.offer.primaryCta}`,
    ...(b.offer.secondaryCta ? [`- **Secondary CTA:** ${b.offer.secondaryCta}`] : []),
    "",
    "## Proof points",
    "",
    list(b.proofPoints.map((p) => `${p.claim} _(${p.source === "needed" ? `needs evidence: ${p.evidence}` : `source: ${p.source === "data" ? "site data" : p.source}, "${p.evidence}"`})_`)),
    "",
    "## Page outline",
    "",
    b.outline.map((s, i) => `${i + 1}. **${s.type}**: ${s.heading}. ${s.purpose}${s.notes ? ` ${s.notes}` : ""}`).join("\n"),
    "",
    "## SEO and AEO",
    "",
    `- **Primary keyword:** ${b.seo.primaryKeyword} (${b.seo.searchIntent})`,
    ...(b.seo.secondaryKeywords.length ? [`- **Secondary keywords:** ${b.seo.secondaryKeywords.join(", ")}`] : []),
    `- **Title:** ${b.seo.title}`,
    `- **Meta description:** ${b.seo.metaDescription}`,
    `- **Slug:** /${b.seo.slug}`,
    `- **Schema:** ${b.seo.schemaTypes.join(", ") || "none"}`,
    `- **Keyword data:** ${b.insights.provider}`,
    ...(b.siteData?.server ? [`- **Site data:** ${b.siteData.server.name} (${b.siteData.facts.length} answers)`] : []),
    "",
    "### Questions to answer",
    "",
    b.seo.questions.map((q) => `**${q.question}**\n${q.answer}`).join("\n\n"),
    "",
  );
  if (b.assumptions.length) out.push("## Assumptions to confirm", "", list(b.assumptions), "");
  return out.join("\n");
}
