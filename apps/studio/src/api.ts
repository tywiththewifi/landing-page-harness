import type { Brief } from "@lph/brief/schema";
import type { GateReport } from "@lph/checks/browser";
import type { Submission } from "@lph/forms";
import type { Page } from "@lph/page/browser";
import type { PublishPlan, SiteConfig } from "@lph/publisher/browser";
import type { Brand, ContrastCheck } from "@lph/tokens";

export interface Job {
  id: string;
  status: "running" | "done" | "failed";
  step: string;
  brandId?: string;
  briefId?: string;
  pageId?: string;
  error?: string;
}

export type BriefSummary = Pick<Brief, "id" | "title" | "prompt" | "funnelStage" | "updatedAt">;
export type PageSummary = Pick<Page, "id" | "title" | "slug" | "updatedAt"> & { versions: number };
export interface Generators {
  name: string;
  model: string | null;
  page?: { name: string; model: string | null };
}
/** A lead the API's form endpoint received, and what happened when it was sent on. */
export interface Lead extends Submission {
  id: string;
  receivedAt: string;
  delivery: { status: "sent" | "stored" | "failed"; connector: string; detail?: string };
}
/** What publishing would do now, as the API works it out. Nothing is written. */
export interface PublishInfo {
  /** The site repo pull requests go to. Null when none is connected (and in the demo). */
  target: { kind: "github"; repo: string; base: string; reviewers: string[] } | null;
  config: SiteConfig;
  /** The latest gate report, when it's for the page as it is now. Publishing needs one. */
  gate: GateReport | null;
  /** The latest gate report, current or not. Null before the checks have run. */
  report: GateReport | null;
  plan: Omit<PublishPlan, "files">;
  published: Page["published"] | null;
  /** Whether a person may publish or download a page the checks blocked, with a reason. */
  overrideAllowed: boolean;
}
export interface PublishResult {
  number: number;
  url: string;
  branch: string;
  commit: string;
  created: boolean;
  unchanged: boolean;
  risk: "content" | "review";
  reasons: string[];
  previews: PublishPlan["previews"];
  override: PublishPlan["override"];
}
export interface SeoProviderInfo {
  id: string;
  name: string;
  description: string;
}

/**
 * True in the in-browser demo build (`vite build --mode demo`), where src/demo/api.ts
 * answers these calls instead of the server.
 */
export const DEMO = import.meta.env.MODE === "demo";

/**
 * The demo's import service (apps/api/src/public.ts), when the build names one with
 * VITE_IMPORT_API: it opens other sites and their MCP servers, which a browser can't.
 */
export const IMPORT_SERVICE: string | null = (DEMO && (import.meta.env.VITE_IMPORT_API as string | undefined)?.replace(/\/+$/, "")) || null;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("json") ? res.json() : res.text()) as Promise<T>;
}

export const api = {
  listBrands: () => request<Pick<Brand, "id" | "name" | "url" | "updatedAt">[]>("/api/brands"),
  importBrand: (url: string, productUrl?: string) =>
    request<Job>("/api/brands", { method: "POST", body: JSON.stringify({ url, productUrl: productUrl || undefined }) }),
  job: (id: string) => request<Job>(`/api/jobs/${id}`),
  brand: (id: string) => request<Brand>(`/api/brands/${id}`),
  save: (brand: Brand) => request<Brand>(`/api/brands/${brand.id}`, { method: "PUT", body: JSON.stringify(brand) }),
  resolve: (id: string, conflictId: string, value: string) =>
    request<Brand>(`/api/brands/${id}/conflicts/${encodeURIComponent(conflictId)}`, { method: "POST", body: JSON.stringify({ value }) }),
  retry: (id: string) => request<Job>(`/api/brands/${id}/retry`, { method: "POST" }),
  designMd: (id: string) => request<string>(`/api/brands/${id}/design.md`),
  contrast: (id: string) => request<ContrastCheck[]>(`/api/brands/${id}/contrast`),
  confirm: (id: string) => request<{ dir: string; files: string[] }>(`/api/brands/${id}/confirm`, { method: "POST" }),
  previewHtml: (id: string) => request<string>(`/api/brands/${id}/preview.html`),
  connectSiteMcp: (id: string, url: string) => request<Brand>(`/api/brands/${id}/site-mcp`, { method: "POST", body: JSON.stringify({ url }) }),
  allowSiteTools: (id: string, allowed: string[]) => request<Brand>(`/api/brands/${id}/site-mcp`, { method: "PATCH", body: JSON.stringify({ allowed }) }),
  disconnectSiteMcp: (id: string) => request<Brand>(`/api/brands/${id}/site-mcp`, { method: "DELETE" }),

  seoProviders: () => request<SeoProviderInfo[]>("/api/seo/providers"),
  generator: () => request<Generators>("/api/generator"),
  createBrief: (brandId: string, prompt: string, seoProvider?: string, useSiteData = true) =>
    request<Job>(`/api/brands/${brandId}/briefs`, { method: "POST", body: JSON.stringify({ prompt, seoProvider, useSiteData }) }),
  listBriefs: (brandId: string) => request<BriefSummary[]>(`/api/brands/${brandId}/briefs`),
  brief: (id: string) => request<Brief>(`/api/briefs/${id}`),
  saveBrief: (brief: Brief) => request<Brief>(`/api/briefs/${brief.id}`, { method: "PUT", body: JSON.stringify(brief) }),
  briefMd: (id: string) => request<string>(`/api/briefs/${id}/brief.md`),

  createPage: (briefId: string) => request<Job>(`/api/briefs/${briefId}/pages`, { method: "POST" }),
  listPages: (briefId: string) => request<PageSummary[]>(`/api/briefs/${briefId}/pages`),
  page: (id: string) => request<Page>(`/api/pages/${id}`),
  savePage: (page: Page) => request<Page>(`/api/pages/${page.id}`, { method: "PUT", body: JSON.stringify(page) }),
  leads: (pageId: string) => request<Lead[]>(`/api/pages/${pageId}/submissions`),

  runGate: (pageId: string) => request<Job>(`/api/pages/${pageId}/gate`, { method: "POST" }),
  publishInfo: (pageId: string) => request<PublishInfo>(`/api/pages/${pageId}/publish`),
  /** With an override reason, publishes although the checks found errors. */
  publish: (pageId: string, override?: string) =>
    request<PublishResult>(`/api/pages/${pageId}/publish`, { method: "POST", body: JSON.stringify(override ? { override: { reason: override } } : {}) }),
  /** The page as a folder for Cloudflare Pages. With an override reason, even when the checks found errors. */
  siteZip: async (pageId: string, override?: string): Promise<Blob> => {
    const res = await fetch(`/api/pages/${pageId}/site.zip${override ? `?override=${encodeURIComponent(override)}` : ""}`);
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Download failed (${res.status})`);
    return res.blob();
  },
};

/** Polls a job until it finishes, reporting each step. */
export async function waitForJob(job: Job, onStep: (step: string) => void): Promise<Job> {
  let current = job;
  while (current.status === "running") {
    onStep(current.step);
    await new Promise((r) => setTimeout(r, 400));
    current = await api.job(job.id);
  }
  if (current.status === "failed") throw new Error(current.error ?? "Something went wrong");
  return current;
}
