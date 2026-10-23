import type { GateIssue, GateReport } from "@lph/checks/browser";
import { FORM_SCRIPT, renderVersions, type Page } from "@lph/page/browser";
import { toCss, type Brand } from "@lph/tokens";
import type { FormConfig } from "./runtime/handler.ts";
import { RUNTIME_FILES } from "./runtime/sources.ts";

/** How the company's site repo is laid out. Read from lph.json at the repo root, or the defaults. */
export interface SiteConfig {
  /** The live site, e.g. "https://www.example.com". Canonicals and Open Graph URLs use it. */
  origin: string;
  /** The folder that's served at the site's root: Cloudflare Pages' output directory, Astro's public/. "" for the repo root. */
  publicDir: string;
  /** Where page sources live. Never served. */
  sourceDir: string;
  /** The Cloudflare Pages Functions folder, for the form endpoint. Null when forms post to the studio's API. */
  functionsDir: string | null;
  /** Where forms post: "site" for the function on the site itself, or the studio API's origin. */
  formEndpoint: "site" | string;
}

export const DEFAULT_SITE: Omit<SiteConfig, "origin"> = { publicDir: "site", sourceDir: ".lph/pages", functionsDir: "functions", formEndpoint: "site" };

export interface SiteFile {
  path: string;
  content: string;
  /** page: published HTML. source: the page as data. config: shared site files (headers, the form endpoint). */
  kind: "page" | "source" | "config";
}

/** What the repo keeps about a page, beside its HTML: the page itself and what built it. */
export interface PageSource {
  page: Page;
  build: {
    /** Hashes of what shaped the HTML besides the copy. A change here needs a reviewer. */
    tokens: string;
    components: string;
    /** The brand it was built for. */
    brand: { id: string; name: string };
  };
  /** The brief's search targets, so the site's CI can run the same SEO checks. */
  targets: { keyword: string; questions: string[] };
  /** What the gate found when the page was published from the studio. */
  gate: {
    verdict: GateReport["verdict"];
    environment: GateReport["environment"];
    checks: { id: string; status: string; summary: string }[];
    /** Each warning, by what it's about. Once this source is merged, a reviewer has accepted them (see classify). */
    warnings: WarningRef[];
  } | null;
}

/** A warning the gate found, by what it's about rather than its wording. */
export type WarningRef = Pick<GateIssue, "check" | "id" | "path" | "field" | "variant">;

export const warningsOf = (report: GateReport): WarningRef[] =>
  report.checks
    .flatMap((c) => c.issues)
    .filter((i) => i.severity === "warning")
    .map(({ check, id, path, field, variant }) => ({ check, id, ...(path && { path }), ...(field && { field }), ...(variant && { variant }) }));

const join = (...parts: string[]) => parts.filter(Boolean).join("/").replace(/\/+/g, "/");

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Base64(text: string): Promise<string> {
  const buf = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s);
}

/** Where a page's form posts once published. */
export function formAction(page: Pick<Page, "id">, config: Pick<SiteConfig, "formEndpoint">): string {
  return config.formEndpoint === "site" ? `/api/forms/${page.id}` : `${config.formEndpoint.replace(/\/+$/, "")}/api/forms/${page.id}`;
}

/** The HTML file a URL path is served from: /hubspot → hubspot.html, /hubspot/revops → hubspot/revops.html. */
export const htmlFile = (config: Pick<SiteConfig, "publicDir">, urlPath: string) => join(config.publicDir, `${urlPath.replace(/^\/|\/$/g, "")}.html`);
export const sourceFile = (config: Pick<SiteConfig, "sourceDir">, page: Pick<Page, "slug">) => join(config.sourceDir, `${page.slug}.json`);

/**
 * Security headers for the page's URLs, in the _headers format Cloudflare Pages and
 * Netlify read. The page runs one inline script, allowed by its hash; it posts only to
 * the form endpoint and can't be framed.
 */
export async function headersBlock(page: Page, brand: Brand, config: SiteConfig): Promise<string> {
  const formOrigin = config.formEndpoint === "site" ? "'self'" : new URL(config.formEndpoint).origin;
  const styleOrigins = [...new Set(brand.fontSources.stylesheets.map((u) => new URL(u).origin))];
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${await sha256Base64(FORM_SCRIPT)}'`,
    `style-src 'unsafe-inline' ${styleOrigins.join(" ")}`.trim(),
    "font-src 'self' https: data:",
    "img-src 'self' https: data:",
    `connect-src ${formOrigin}`,
    `form-action ${formOrigin}`,
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  const rules = ["Content-Security-Policy: " + csp, "X-Content-Type-Options: nosniff", "Referrer-Policy: strict-origin-when-cross-origin", "Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()"];
  const paths = [`/${page.slug}`, `/${page.slug}/*`];
  return [`# lph:begin ${page.slug}`, ...paths.flatMap((p) => [p, ...rules.map((r) => `  ${r}`)]), `# lph:end ${page.slug}`].join("\n");
}

/**
 * Puts a page's block into an existing _headers file. Each page has its own marked
 * block, so the company's own rules and other pages' blocks are kept as they are.
 */
export function mergeHeaders(existing: string | null, slug: string, block: string): string {
  const marked = new RegExp(`# lph:begin ${slug.replace(/[-]/g, "\\-")}\\n[\\s\\S]*?# lph:end ${slug.replace(/[-]/g, "\\-")}\\n?`);
  const base = (existing ?? "").replace(/\s*$/, "");
  if (marked.test(base + "\n")) return (base + "\n").replace(marked, `${block}\n`);
  return `${base ? `${base}\n\n` : ""}${block}\n`;
}

/** The form's settings for the site's function: fields and where leads go, without secrets. */
export function formConfig(page: Page): FormConfig | null {
  const form = page.blocks.find((b) => b.type === "form");
  if (form?.type !== "form") return null;
  const f = page.form;
  return {
    pageId: page.id,
    pageName: page.title,
    fields: form.fields,
    successMessage: form.successMessage || "Thanks, we got it.",
    connector:
      f.connector === "hubspot"
        ? { kind: "hubspot", portalId: f.hubspotPortalId.trim(), formId: f.hubspotFormId.trim() }
        : f.connector === "webhook"
          ? { kind: "webhook", url: f.webhookUrl.trim() }
          : { kind: "none" },
  };
}

export function mergeForms(existing: string | null, page: Page): string {
  let all: Record<string, FormConfig> = {};
  try {
    all = existing ? JSON.parse(existing) : {};
  } catch {
    all = {};
  }
  const config = formConfig(page);
  if (config) all[page.id] = config;
  else delete all[page.id];
  return `${JSON.stringify(all, null, 2)}\n`;
}

const FUNCTION_ENTRY = `// The form endpoint for pages published by landing-page-harness. Written by the publisher.
import { handleForm, type FormConfig, type FormEnv } from "../../_lph/handler.ts";
import forms from "../../_lph/forms.json";

const configs = forms as Record<string, FormConfig>;

export const onRequest = (context: { request: Request; env: FormEnv; params: { pageId: string } }) =>
  handleForm(context.request, Object.hasOwn(configs, context.params.pageId) ? configs[context.params.pageId] : undefined, context.env);
`;

export interface SiteInput {
  page: Page;
  brand: Brand;
  uiCss: string;
  config: SiteConfig;
  gate?: GateReport | null;
  /** The brief's search targets, kept with the page so the site's CI checks the same things. */
  targets?: PageSource["targets"];
  /** Reads a file as it is on the base branch, to merge shared files. Null when it doesn't exist. */
  read?: (path: string) => Promise<string | null>;
}

/**
 * Everything publishing a page writes into the site repo: the HTML of each version, the
 * page's source, and the shared files the pages need (headers, the form endpoint).
 * Shared files are merged with what's already there.
 */
export async function siteFiles(input: SiteInput): Promise<SiteFile[]> {
  const { page, brand, uiCss, config } = input;
  const read = input.read ?? (async () => null);
  const action = formAction(page, config);
  const versions = renderVersions(page, brand, uiCss, { origin: config.origin, formAction: action });
  const files: SiteFile[] = versions.map((v) => ({ path: htmlFile(config, v.path), content: v.html, kind: "page" }));

  // Where the studio last published it is the studio's business, not the site's.
  const { published: _, ...clean } = page;
  const source: PageSource = {
    page: clean,
    build: { tokens: await sha256(toCss(brand)), components: await sha256(uiCss), brand: { id: brand.id, name: brand.name } },
    targets: input.targets ?? { keyword: "", questions: [] },
    gate: input.gate
      ? { verdict: input.gate.verdict, environment: input.gate.environment, checks: input.gate.checks.map(({ id, status, summary }) => ({ id, status, summary })), warnings: warningsOf(input.gate) }
      : null,
  };
  files.push({ path: sourceFile(config, page), content: `${JSON.stringify(source, null, 2)}\n`, kind: "source" });

  const headersPath = join(config.publicDir, "_headers");
  files.push({ path: headersPath, content: mergeHeaders(await read(headersPath), page.slug, await headersBlock(page, brand, config)), kind: "config" });

  if (config.functionsDir && config.formEndpoint === "site") {
    const formsPath = join(config.functionsDir, "_lph/forms.json");
    files.push({ path: formsPath, content: mergeForms(await read(formsPath), page), kind: "config" });
    files.push({ path: join(config.functionsDir, "api/forms/[pageId].ts"), content: FUNCTION_ENTRY, kind: "config" });
    for (const [name, content] of Object.entries(RUNTIME_FILES)) files.push({ path: join(config.functionsDir, "_lph", name), content, kind: "config" });
  }
  return files;
}

/** Reads the page source back from the repo. Null when it isn't one. */
export function parseSource(text: string | null): PageSource | null {
  if (!text) return null;
  try {
    const data = JSON.parse(text) as PageSource;
    return data && typeof data === "object" && data.page && data.build ? data : null;
  } catch {
    return null;
  }
}
