# Build spec: on-brand landing pages that non-engineers can ship safely

Consolidated 2026-10-22 from Tyler's decisions in the "Job description test projects" thread. The reference is a demo product ("Automaterra Campaign Hub", running inside a Webflow-style editor) that we improve on. Working repo name: `guardrail-studio` (rename freely).

**The pitch it supports:** "Non-technical teams can launch on-brand, SEO-ready pages without waiting on engineering, and nothing reaches production without passing brand, accessibility, performance and SEO checks." It's portable to any stack because it reads CSS and publishes via pull request.

## User flow

1. **Brand import.** Enter a URL. We sample the home page plus one main product page, render them in a headless browser, and measure computed CSS. The output is design tokens, Design.md and starter components. In the review UI, the Theme tab is editable and Design.md is generated from it. Every value shows its source and a confidence score, and conflicts are flagged.
2. **Brief.** The user describes the campaign or page in a prompt box (with type chips and attachments, but no language selector). The AI writes an editable brief: objective + KPI, personas, funnel stage, channels, key messages, offer/CTA, proof points (cited from the site), page outline, and SEO/AEO targets. SEO/AEO data comes from whatever tools the user connects, with generic best practices as the fallback. A consistency check flags contradictions between sections.
3. **Build + variants.** A landing page is generated from the starter components. Editing is **constrained**: copy plus component props within the tokens, with no free layout. There's one variant per persona, each on its **own URL slug**, plus a table view (slug, H1, subheadline, CTA, personalized elements).
4. **Publish.** A pre-publish gate runs brand lint, accessibility (axe), performance (Lighthouse budget) and SEO/AEO checks (title/meta, one H1, schema, answers to the brief's questions). Publishing then **opens a pull request into the company's repo** with a preview link. Low-risk content changes can auto-merge once checks pass, and anything touching components or config needs a reviewer. Self-hosting on Cloudflare is the fallback.
5. **Forms.** Submissions go to a webhook, with **HubSpot** as the first connector.

Out of scope for v1: ads, dark mode, multiple brands, language selector, single-URL personalization.

## Architecture

Stack chosen to mirror Genki's (TypeScript, React, React Router, Vite, SCSS Modules, Astro, Cloudflare, Railway), so the repo doubles as the case study.

```
apps/
  studio/        React Router + Vite web app (brand review, brief, editor, variants, publish), on Cloudflare
  api/           Node (Hono) service on Railway: extraction (Playwright), LLM calls, jobs, storage
  demo-site/     Astro site standing in for "the company's repo"; receives the publish PRs
packages/
  extractor/     page sampling, computed-style collection, clustering into tokens, source and confidence
  tokens/        DTCG tokens.json ↔ tokens.css, contrast checks
  ui/            starter components (Button variants, Card, Hero band, Nav, Footer, Form, Section), CSS vars + React
  design-md/     Design.md generator and brand-lint rules
  brief/         brief schema (zod), generation, consistency checks
  seo/           SeoProvider interface; best-practices provider; GSC/Semrush/etc. adapters later
  checks/        pre-publish gate: brand lint, axe, Lighthouse, SEO/AEO lint
  publisher/     GitHub PR publisher (branch, commit page files, PR body with check results + preview link)
  forms/         webhook receiver + HubSpot connector
  mcp/           MCP server over the public API (brands, briefs, pages, publish)
```

**LLM rule:** models name, describe and write. They never invent measured values. Values come from CSS, and copy is checked against Design.md before it's shown.

**Agent interface:** `GET/POST /brands`, `/briefs`, `/pages`, `/pages/:id/variants`, `/pages/:id/publish`, served as REST, with an MCP server wrapping the same calls.

## Milestones

| # | Milestone | Proves |
|---|---|---|
| M1 | Brand import: extractor, tokens, Design.md, review UI | Design-system reading on any CSS site |
| M2 | Brief: prompt → editable brief, best-practices SEO provider, consistency check | Marketing fluency, grounded AI |
| M3 | Build: page generation from `ui`, constrained editor, persona variants | Component library, design craft |
| M4 | Publish: checks gate, GitHub PR publisher, demo-site preview deploys, webhook + HubSpot | CI/CD, guardrails, the "safe self-serve" thesis |
| M5 | API + MCP, README, 2-minute demo video, Genki case-study page | Systems thinking, any-agent design |

Run M1 against genki.world as the first case study, and against one more site to show portability.
