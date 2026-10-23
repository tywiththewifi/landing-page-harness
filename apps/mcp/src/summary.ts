import type { Brief, BriefIssue } from "@lph/brief";
import type { GateReport } from "@lph/checks";
import type { Page, PageIssue } from "@lph/page";
import type { Brand } from "@lph/tokens";

/**
 * Short, readable views of the API's records for agents. The full records are large
 * (every value carries its sources), so tools return these and link to the rest.
 */

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function brandSummary(brand: Brand) {
  return {
    id: brand.id,
    name: brand.name,
    url: brand.url,
    pagesSampled: brand.pages,
    fonts: brand.fonts,
    colors: brand.colors.map((c) => ({ name: c.name, value: c.value, role: c.role, confidence: pct(c.confidence) })),
    type: brand.typography.map((t) => `${t.role}: ${t.fontFamily} ${t.fontSize}px/${t.lineHeight}px ${t.fontWeight}`),
    buttons: brand.buttons.map((b) => `${b.name} (${b.kind}): ${b.background ?? "transparent"} / ${b.color}, radius ${b.radius}px, "${b.sampleText}"`),
    cards: brand.cards.length,
    logo: brand.logo?.kind ?? "not found",
    /** Names in a logo row that match these show as the site's logos. */
    customerLogos: (brand.customers ?? []).map((c) => c.name),
    conflicts: brand.conflicts.map((c) => ({ id: c.id, field: c.field, message: c.message, options: c.options.map((o) => o.value), resolved: c.resolved ?? null })),
    warnings: brand.warnings,
  };
}

export type BrandSummary = ReturnType<typeof brandSummary>;

const count = (issues: { severity: string }[]) => ({
  errors: issues.filter((i) => i.severity === "error").length,
  warnings: issues.filter((i) => i.severity === "warning").length,
  info: issues.filter((i) => i.severity === "info").length,
});

export function issueSummary(issues: (BriefIssue | PageIssue)[]) {
  return {
    ...count(issues),
    // Info is noise for an agent deciding what to fix; the counts still say how many there were.
    issues: issues.filter((i) => i.severity !== "info").map((i) => `${i.severity}: ${"section" in i ? `[${i.section}] ` : `[${i.area}${i.variant ? ` / ${i.variant}` : ""}] `}${i.message}`),
  };
}

export function briefSummary(brief: Brief, issues: BriefIssue[]) {
  return {
    id: brief.id,
    generator: brief.generator.model ? `${brief.generator.name} (${brief.generator.model})` : brief.generator.name,
    title: brief.title,
    objective: brief.objective.statement,
    cta: brief.offer.primaryCta,
    personas: brief.personas.map((p) => p.name),
    primaryKeyword: brief.seo.primaryKeyword,
    outline: brief.outline.map((s) => s.type),
    check: issueSummary(issues),
  };
}

export function pageSummary(page: Page, issues: PageIssue[]) {
  const hero = page.blocks.find((b) => b.type === "hero");
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    h1: hero?.type === "hero" ? hero.heading : null,
    blocks: page.blocks.map((b) => b.type),
    versions: page.variants.map((v) => ({ name: v.name, slug: v.slug, overrides: Object.keys(v.overrides).length })),
    check: issueSummary(issues),
  };
}

export function gateSummary(report: GateReport) {
  return {
    verdict: report.verdict,
    checks: report.checks.map((c) => ({
      check: c.title,
      status: c.status,
      summary: c.summary,
      issues: c.issues.filter((i) => i.severity !== "info").map((i) => `${i.severity}: ${i.message}${i.path ? ` (${i.path})` : ""}`),
    })),
    performance: report.performance.map((p) => ({ path: p.path, lcpMs: p.lcpMs, cls: p.cls, tbtMs: p.tbtMs, transferKb: p.transferBytes == null ? null : Math.round(p.transferBytes / 1024), requests: p.requests })),
  };
}
