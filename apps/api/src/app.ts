import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { join } from "node:path";
import { z } from "zod";
import {
  bestPractices,
  briefEdit,
  briefToMarkdown,
  checkBrief,
  collectSiteData,
  defaultGenerator,
  GenerationError,
  inspectMcp,
  parsePrompt,
  toBrief,
  type Brief,
  type BriefGenerator,
  type SeoInsights,
  type SeoProvider,
  type SiteData,
} from "@lph/brief";
import { runGate, serverRunner, type GateReport, type GateRunner } from "@lph/checks";
import { generateDesignMd } from "@lph/design-md";
import { extractBrand, type ExtractOptions } from "@lph/extractor";
import { deliver, parseSubmission, type Connector, type DeliveryResult } from "@lph/forms";
import { previewHtml, uiCss, writeBrandKit } from "@lph/kit";
import { checkPage, defaultPageGenerator, findVariant, pageEdit, pruneOverrides, renderPage, renderVersions, toPage, type Page, type PageGenerator } from "@lph/page";
import { cloudflareZip, DEFAULT_SITE, formAction, github, GitHubError, overrideFor, planPublish, type GitHubTarget, type SiteConfig } from "@lph/publisher";
import { checkContrast, resolveConflict, toCss, toDtcg, type Brand } from "@lph/tokens";
import { openApi } from "./openapi.ts";
import type { BrandStore, BriefStore, GateStore, PageStore, StoredSubmission, SubmissionStore } from "./store.ts";
import { assertPublicUrl, browserGuard, UrlRejected } from "./url-guard.ts";

export interface Job {
  id: string;
  status: "running" | "done" | "failed";
  step: string;
  brandId?: string;
  briefId?: string;
  pageId?: string;
  error?: string;
}

export interface AppOptions {
  store: BrandStore;
  briefs: BriefStore;
  pages: PageStore;
  submissions: SubmissionStore;
  /** The latest publish gate report for each page. */
  gates: GateStore;
  /** Runs the gate's browser checks (axe, lab timings). Defaults to Chromium on this server. */
  gateRunner?: () => Promise<GateRunner>;
  /**
   * Publishing. With a GitHub repo, pages are published as pull requests into it; the
   * repo's lph.json says how it's laid out, and `site` overrides it. Without one, pages
   * download as a folder for Cloudflare Pages.
   */
  publish?: { github?: GitHubTarget; site?: Partial<SiteConfig>; previewUrl?: string };
  /**
   * Lets a person publish or download a page the checks blocked, with a reason. The pull
   * request is labelled lph:override and goes to a reviewer, and the site's CI still fails.
   * On by default; LPH_PUBLISH_OVERRIDE=off turns it off.
   */
  allowOverride?: boolean;
  /** Writes briefs. Defaults to Claude when credentials are set, the offline template otherwise. */
  generator?: BriefGenerator;
  /** Writes page copy. Same default as briefs. */
  pageGenerator?: PageGenerator;
  /**
   * Secrets for sending leads on, from the server's environment: LPH_WEBHOOK_SECRET signs
   * webhook posts, HUBSPOT_ACCESS_TOKEN (a private app token) uses HubSpot's authenticated endpoint.
   */
  formSecrets?: { webhookSecret?: string; hubspotToken?: string };
  /** SEO/AEO sources to choose from. Best practices is always available. */
  seoProviders?: SeoProvider[];
  /** Where confirmed brand kits are written. */
  outputDir: string;
  extract?: (opts: ExtractOptions) => Promise<Brand>;
  allowPrivateUrls?: boolean;
}

const importBody = z.object({
  url: z.string().min(1),
  productUrl: z.string().optional(),
});

/** The parts of a brand the review screen may edit. Values are validated, ids and provenance are kept. */
const hex = z.string().regex(/^#[0-9a-f]{6}$/i, "Colours must be #rrggbb");
const brandEdit = z.object({
  name: z.string().min(1).max(80),
  summary: z.string().max(2000),
  fonts: z.object({ heading: z.string().min(1), body: z.string().min(1) }),
  colors: z.array(z.object({ name: z.string().regex(/^[a-z0-9-]+$/), value: hex }).passthrough()),
  typography: z.array(
    z
      .object({
        fontFamily: z.string().min(1),
        fontSize: z.number().positive().max(400),
        fontWeight: z.number().min(100).max(1000),
        lineHeight: z.number().positive().max(600),
        letterSpacing: z.number().min(-20).max(40),
      })
      .passthrough(),
  ),
  radii: z.array(z.object({ name: z.string(), value: z.number().min(0) }).passthrough()),
  spacing: z.array(z.object({ name: z.string(), value: z.number().min(0) }).passthrough()),
  buttons: z.array(z.object({ name: z.string().regex(/^[a-z0-9-]+$/), color: hex, background: hex.nullable(), radius: z.number().min(0) }).passthrough()),
  cards: z.array(z.object({ name: z.string().regex(/^[a-z0-9-]+$/), background: hex, radius: z.number().min(0) }).passthrough()),
  usageRules: z.array(z.string().max(500)),
  /** Customer logos can be renamed, reordered or removed; only the ones imported from the site are kept (see keepCustomers). */
  customers: z.array(z.object({ name: z.string().trim().max(80), svg: z.string().optional(), src: z.string().optional() })).optional(),
});

/** The edited list of customer logos, each matched to one the site gave by its image, so markup can't come in through an edit. */
const keepCustomers = (current: Brand, edited: { name: string; svg?: string; src?: string }[]) =>
  edited.flatMap((e) => {
    const known = current.customers?.find((c) => (e.svg ? c.svg === e.svg : !!e.src && c.src === e.src));
    return known ? [{ ...known, name: e.name || known.name }] : [];
  });

const briefRequest = z.object({
  prompt: z.string().trim().min(3, "Describe the page or campaign").max(2000),
  seoProvider: z.string().optional(),
  /** Read the site's MCP server first. Defaults to true when one is connected. */
  useSiteData: z.boolean().optional(),
});

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brand";

export function createApp(opts: AppOptions) {
  const { store, briefs } = opts;
  const extract = opts.extract ?? extractBrand;
  const generator = opts.generator ?? defaultGenerator();
  const pageGenerator = opts.pageGenerator ?? defaultPageGenerator();
  const { pages, submissions, gates } = opts;
  const providers = opts.seoProviders?.length ? opts.seoProviders : [bestPractices];
  const jobs = new Map<string, Job>();
  const app = new Hono();

  app.use("/api/*", cors());

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    if (err instanceof UrlRejected) return c.json({ error: err.message }, 400);
    if (err instanceof GenerationError) return c.json({ error: err.message }, 502);
    if (err instanceof GitHubError) return c.json({ error: err.message }, err.status === 409 ? 409 : 502);
    if (err instanceof z.ZodError) return c.json({ error: "Invalid request", issues: err.issues }, 400);
    console.error(err);
    return c.json({ error: "Something went wrong" }, 500);
  });

  const mustGet = async (id: string) => {
    const brand = await store.get(id).catch(() => null);
    if (!brand) throw new HTTPException(404, { message: "Brand not found" });
    return brand;
  };

  const mustGetBrief = async (id: string) => {
    const brief = await briefs.get(id).catch(() => null);
    if (!brief) throw new HTTPException(404, { message: "Brief not found" });
    return brief;
  };

  const mustGetPage = async (id: string) => {
    const page = await pages.get(id).catch(() => null);
    if (!page) throw new HTTPException(404, { message: "Page not found" });
    return page;
  };

  /** Runs work in the background and tracks it as a job that clients poll. */
  const runJob = (work: (job: Job) => Promise<Partial<Job>>) => {
    const job: Job = { id: crypto.randomUUID(), status: "running", step: "Starting" };
    jobs.set(job.id, job);
    const done = (async () => {
      try {
        Object.assign(job, { status: "done", step: "Done", ...(await work(job)) });
      } catch (err) {
        Object.assign(job, { status: "failed", error: err instanceof Error ? err.message : String(err) });
      }
      return job;
    })();
    return { job, done };
  };

  /** Extracts a brand from its pages. */
  const startJob = (input: ExtractOptions, keepId?: string) =>
    runJob(async (job) => {
      const brand = await extract({ ...input, ...browserGuard(opts.allowPrivateUrls), onProgress: (step) => (job.step = step) });
      if (keepId) brand.id = keepId;
      await store.save(brand);
      return { brandId: brand.id };
    });

  /** Researches keywords, then writes the brief. A failing SEO tool falls back to best practices. */
  const research = async (provider: SeoProvider, input: Parameters<SeoProvider["research"]>[0]): Promise<SeoInsights> => {
    try {
      return await provider.research(input);
    } catch (err) {
      const fallback = await bestPractices.research(input);
      return { ...fallback, notes: [`${provider.name} couldn't be reached (${(err as Error).message}), so best practices were used.`, ...fallback.notes] };
    }
  };
  /** Asks the site's MCP server about the topic. If it can't be reached, the brief uses the site copy only. */
  const readSiteData = async ({ url, name, allowed }: NonNullable<Brand["siteMcp"]>, prompt: string): Promise<SiteData> => {
    try {
      await assertPublicUrl(url, opts.allowPrivateUrls);
      return await collectSiteData(url, parsePrompt(prompt).topic, { allowed });
    } catch (err) {
      return { server: { name, url }, facts: [], notes: [`${name} couldn't be reached (${(err as Error).message}), so the brief uses the site copy only.`] };
    }
  };
  const startBrief = (brand: Brand, prompt: string, provider: SeoProvider, useSiteData: boolean) =>
    runJob(async (job) => {
      let siteData: SiteData | undefined;
      if (useSiteData && brand.siteMcp) {
        job.step = `Reading site data from ${brand.siteMcp.name}`;
        siteData = await readSiteData(brand.siteMcp, prompt);
      }
      job.step = `Researching keywords with ${provider.name}`;
      const insights = await research(provider, { topic: prompt, siteUrl: brand.url, lang: brand.content?.[0]?.lang ?? "en" });
      job.step = "Writing the brief";
      const content = await generator.generate({ prompt, brand, insights, siteData });
      const brief = toBrief(content, { id: crypto.randomUUID(), brandId: brand.id, prompt, generator, insights, siteData });
      await briefs.save(brief);
      return { brandId: brand.id, briefId: brief.id };
    });

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/api/openapi.json", (c) => c.json(openApi));

  app.get("/api/brands", async (c) => c.json(await store.list()));
  app.get("/api/seo/providers", (c) => c.json(providers.map(({ id, name, description }) => ({ id, name, description }))));
  app.get("/api/generator", (c) =>
    c.json({ name: generator.name, model: generator.model ?? null, page: { name: pageGenerator.name, model: pageGenerator.model ?? null } }),
  );

  // Import a brand from a URL. Returns a job; pass ?wait=true to block until it finishes.
  app.post("/api/brands", async (c) => {
    const body = importBody.parse(await c.req.json());
    const url = await assertPublicUrl(body.url, opts.allowPrivateUrls);
    const productUrl = body.productUrl ? await assertPublicUrl(body.productUrl, opts.allowPrivateUrls) : undefined;
    const { job, done } = startJob({ url: url.href, productUrl: productUrl?.href });
    if (c.req.query("wait") === "true") {
      const finished = await done;
      if (finished.status === "failed") return c.json(finished, 502);
      return c.json(await mustGet(finished.brandId!), 201);
    }
    return c.json(job, 202);
  });

  app.get("/api/jobs/:id", (c) => {
    const job = jobs.get(c.req.param("id"));
    return job ? c.json(job) : c.json({ error: "Job not found" }, 404);
  });

  app.get("/api/brands/:id", async (c) => c.json(await mustGet(c.req.param("id"))));

  // Save edits from the Theme tab. Provenance and ids come from the stored brand.
  app.put("/api/brands/:id", async (c) => {
    const current = await mustGet(c.req.param("id"));
    const { customers, ...edit } = brandEdit.parse(await c.req.json());
    const next: Brand = {
      ...current,
      ...(edit as unknown as Partial<Brand>),
      ...(customers && { customers: keepCustomers(current, customers) }),
      id: current.id,
      url: current.url,
      pages: current.pages,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };
    return c.json(await store.save(next));
  });

  app.post("/api/brands/:id/conflicts/:conflictId", async (c) => {
    const brand = await mustGet(c.req.param("id"));
    const { value } = z.object({ value: z.string() }).parse(await c.req.json());
    try {
      return c.json(await store.save(resolveConflict(brand, c.req.param("conflictId"), value)));
    } catch (err) {
      throw new HTTPException(400, { message: (err as Error).message });
    }
  });

  // "Try again": re-sample the same pages and keep the brand id.
  app.post("/api/brands/:id/retry", async (c) => {
    const brand = await mustGet(c.req.param("id"));
    const { job } = startJob({ url: brand.pages[0]!, productUrl: brand.pages[1] }, brand.id);
    return c.json(job, 202);
  });

  // The site's own MCP server, if it has one. Only read-only tools are called, plus any a person allows.
  const connectSiteMcp = async (brand: Brand, raw: string, allowed: string[]) => {
    const url = await assertPublicUrl(raw, opts.allowPrivateUrls);
    try {
      return await store.save({ ...brand, siteMcp: await inspectMcp(url.href, { allowed }) });
    } catch (err) {
      throw new HTTPException(502, { message: `Couldn't connect to an MCP server at ${url.href} (${(err as Error).message}).` });
    }
  };
  app.post("/api/brands/:id/site-mcp", async (c) => {
    const brand = await mustGet(c.req.param("id"));
    const body = z.object({ url: z.string().min(1), allowed: z.array(z.string()).default([]) }).parse(await c.req.json());
    return c.json(await connectSiteMcp(brand, body.url, body.allowed));
  });
  // Change which tools a person allows. Re-reads the server so the list is current.
  app.patch("/api/brands/:id/site-mcp", async (c) => {
    const brand = await mustGet(c.req.param("id"));
    if (!brand.siteMcp) throw new HTTPException(404, { message: "No MCP server is connected" });
    const { allowed } = z.object({ allowed: z.array(z.string()) }).parse(await c.req.json());
    return c.json(await connectSiteMcp(brand, brand.siteMcp.url, allowed));
  });
  app.delete("/api/brands/:id/site-mcp", async (c) => {
    const { siteMcp: _, ...brand } = await mustGet(c.req.param("id"));
    return c.json(await store.save(brand));
  });

  // Phase 2: a prompt becomes a marketing brief grounded in the brand's site.
  app.post("/api/brands/:id/briefs", async (c) => {
    const brand = await mustGet(c.req.param("id"));
    const body = briefRequest.parse(await c.req.json());
    // A connected tool, when there is one, is the default over best practices.
    const provider = providers.find((p) => p.id === (body.seoProvider ?? providers.at(-1)!.id));
    if (!provider) throw new HTTPException(400, { message: `Unknown SEO provider "${body.seoProvider}"` });
    const { job, done } = startBrief(brand, body.prompt, provider, body.useSiteData ?? true);
    if (c.req.query("wait") === "true") {
      const finished = await done;
      if (finished.status === "failed") return c.json(finished, 502);
      return c.json(await mustGetBrief(finished.briefId!), 201);
    }
    return c.json(job, 202);
  });
  app.get("/api/brands/:id/briefs", async (c) => c.json(await briefs.listFor((await mustGet(c.req.param("id"))).id)));

  app.get("/api/briefs/:id", async (c) => c.json(await mustGetBrief(c.req.param("id"))));
  // Save edits. The prompt, ids for the brand and brief, and keyword data stay as stored.
  app.put("/api/briefs/:id", async (c) => {
    const current = await mustGetBrief(c.req.param("id"));
    const edit = briefEdit.parse(await c.req.json());
    const next: Brief = { ...current, ...edit, updatedAt: new Date().toISOString() };
    return c.json(await briefs.save(next));
  });
  app.get("/api/briefs/:id/check", async (c) => {
    const brief = await mustGetBrief(c.req.param("id"));
    return c.json(checkBrief(brief, await mustGet(brief.brandId)));
  });
  app.get("/api/briefs/:id/brief.md", async (c) => {
    c.header("content-type", "text/markdown; charset=utf-8");
    return c.body(briefToMarkdown(await mustGetBrief(c.req.param("id"))));
  });

  // Phase 3: a brief becomes a page built from the component library, with a version per persona.
  app.post("/api/briefs/:id/pages", async (c) => {
    const brief = await mustGetBrief(c.req.param("id"));
    const brand = await mustGet(brief.brandId);
    const blocking = checkBrief(brief, brand).filter((i) => i.severity === "error");
    if (blocking.length) return c.json({ error: "Fix the brief's must-fix issues first.", issues: blocking }, 409);
    const { job, done } = runJob(async (job) => {
      job.step = "Writing the page";
      const draft = await pageGenerator.generate({ brief, brand });
      const page = toPage(draft, { id: crypto.randomUUID(), brief, generator: pageGenerator });
      await pages.save(page);
      return { brandId: brand.id, briefId: brief.id, pageId: page.id };
    });
    if (c.req.query("wait") === "true") {
      const finished = await done;
      if (finished.status === "failed") return c.json(finished, 502);
      return c.json(await mustGetPage(finished.pageId!), 201);
    }
    return c.json(job, 202);
  });
  app.get("/api/briefs/:id/pages", async (c) => c.json(await pages.listFor((await mustGetBrief(c.req.param("id"))).id)));

  app.get("/api/pages/:id", async (c) => c.json(await mustGetPage(c.req.param("id"))));
  // Save edits. Ids, the brand and brief it came from, and provenance stay as stored.
  app.put("/api/pages/:id", async (c) => {
    const current = await mustGetPage(c.req.param("id"));
    const edit = pageEdit.parse(await c.req.json());
    const next: Page = pruneOverrides({ ...current, ...edit, updatedAt: new Date().toISOString() });
    return c.json(await pages.save(next));
  });
  app.get("/api/pages/:id/check", async (c) => {
    const page = await mustGetPage(c.req.param("id"));
    return c.json(checkPage(page, await mustGetBrief(page.briefId), await mustGet(page.brandId)));
  });
  // The page as it will be published. ?version=<slug> renders a persona's version. Previews are never indexed.
  app.get("/api/pages/:id/page.html", async (c) => {
    const page = await mustGetPage(c.req.param("id"));
    const version = c.req.query("version");
    if (version && !findVariant(page, version)) throw new HTTPException(404, { message: "Version not found" });
    const origin = new URL(c.req.url).origin;
    return c.html(renderPage(page, await mustGet(page.brandId), await uiCss(), { variant: version, formAction: `${origin}/api/forms/${page.id}`, noindex: true }));
  });
  app.get("/api/pages/:id/submissions", async (c) => c.json(await submissions.listFor((await mustGetPage(c.req.param("id"))).id)));

  /** Where a page's leads go, with secrets from the environment rather than the page. */
  const connectorFor = async (page: Page): Promise<Connector> => {
    const { form } = page;
    if (form.connector === "hubspot") return { kind: "hubspot", portalId: form.hubspotPortalId.trim(), formId: form.hubspotFormId.trim(), token: opts.formSecrets?.hubspotToken };
    if (form.connector === "webhook") {
      const url = await assertPublicUrl(form.webhookUrl.trim(), opts.allowPrivateUrls);
      return { kind: "webhook", url: url.href, secret: opts.formSecrets?.webhookSecret };
    }
    return { kind: "none" };
  };

  // A page's form posts here, urlencoded from the page's script or a plain form post, or JSON from other clients.
  app.post("/api/forms/:pageId", async (c) => {
    const page = await pages.get(c.req.param("pageId")).catch(() => null);
    const form = page?.blocks.find((b) => b.type === "form");
    if (!page || form?.type !== "form") return c.json({ error: "Form not found" }, 404);
    const type = c.req.header("content-type") ?? "";
    const body = type.includes("application/json") ? await c.req.json().catch(() => null) : await c.req.parseBody().catch(() => null);
    const parsed = parseSubmission(body, form.fields);
    if (!parsed.ok) return c.json({ message: "Please check the highlighted fields.", errors: parsed.errors }, 422);
    // Bots that fill the hidden field are told it worked and nothing is kept.
    if (parsed.spam) return c.json({ ok: true, message: form.successMessage });

    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    let result: DeliveryResult;
    try {
      result = await deliver(parsed.submission, await connectorFor(page), { pageId: page.id, ipAddress: ip });
    } catch (err) {
      // The webhook URL points somewhere private. The lead is still kept below.
      result = { ok: false, status: "failed", message: "Sorry, that didn't go through. Please try again in a moment.", detail: `The webhook URL was refused: ${(err as Error).message}` };
    }
    const now = new Date().toISOString();
    const record: StoredSubmission = {
      ...parsed.submission,
      id: crypto.randomUUID(),
      pageId: page.id,
      receivedAt: now,
      updatedAt: now,
      delivery: { status: result.status, connector: page.form.connector, ...(result.detail && { detail: result.detail }) },
    };
    await submissions.save(record);
    if (!result.ok) {
      console.error(`Form ${page.id}: ${result.detail}`);
      return c.json({ ok: false, message: result.message }, 502);
    }
    return c.json({ ok: true, message: form.successMessage });
  });

  app.get("/api/brands/:id/tokens.css", async (c) => {
    c.header("content-type", "text/css; charset=utf-8");
    return c.body(toCss(await mustGet(c.req.param("id"))));
  });
  app.get("/api/brands/:id/tokens.json", async (c) => c.json(toDtcg(await mustGet(c.req.param("id")))));
  app.get("/api/brands/:id/design.md", async (c) => {
    c.header("content-type", "text/markdown; charset=utf-8");
    return c.body(generateDesignMd(await mustGet(c.req.param("id"))));
  });
  app.get("/api/brands/:id/contrast", async (c) => c.json(checkContrast(await mustGet(c.req.param("id")))));
  app.get("/api/brands/:id/preview.html", async (c) => c.html(await previewHtml(await mustGet(c.req.param("id")))));

  // Phase 4: the publish gate, then a pull request into the company's site repo (or a Cloudflare Pages bundle).
  let runner: Promise<GateRunner> | null = null;
  const getRunner = () => (runner ??= opts.gateRunner ? opts.gateRunner() : serverRunner(browserGuard(opts.allowPrivateUrls)));
  const repo = opts.publish?.github ? github(opts.publish.github) : null;
  const relPath = z.string().regex(/^(?!\/)(?!.*(^|\/)\.\.(\/|$))[\w.\-/]*$/, "A path inside the repo");
  const siteSettings = z.object({
    origin: z.string().regex(/^https?:\/\/[^/]+$/, "The site's origin, like https://www.example.com"),
    publicDir: relPath,
    sourceDir: relPath.min(1),
    functionsDir: relPath.min(1).nullable(),
    formEndpoint: z.union([z.literal("site"), z.string().regex(/^https:\/\/[^/]+$/)]),
  });
  /** How the site repo is laid out: the defaults, then the repo's lph.json, then the server's settings. */
  const siteConfig = async (brand: Brand): Promise<SiteConfig> => {
    let fromRepo: Partial<SiteConfig> = {};
    const text = repo ? await repo.read("lph.json").catch(() => null) : null;
    try {
      if (text) fromRepo = JSON.parse(text);
    } catch {
      throw new HTTPException(502, { message: "The site repo's lph.json isn't valid JSON." });
    }
    const merged = { ...DEFAULT_SITE, origin: new URL(brand.url).origin, ...fromRepo, ...opts.publish?.site };
    const parsed = siteSettings.safeParse(merged);
    if (!parsed.success) throw new HTTPException(502, { message: `The site settings aren't usable: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
    return parsed.data;
  };
  const targetsOf = (brief: Brief) => ({ keyword: brief.seo.primaryKeyword, questions: brief.seo.questions.map((q) => q.question) });
  /** The latest report, when it's for the page as it is now. */
  const freshGate = async (page: Page) => {
    const report = await gates.latest(page.id);
    return report && report.pageUpdatedAt === page.updatedAt ? report : null;
  };

  app.post("/api/pages/:id/gate", async (c) => {
    const page = await mustGetPage(c.req.param("id"));
    const brief = await mustGetBrief(page.briefId);
    const brand = await mustGet(page.brandId);
    const { job, done } = runJob(async (job) => {
      job.step = "Rendering every version";
      const config = await siteConfig(brand);
      const versions = renderVersions(page, brand, await uiCss(), { origin: config.origin, formAction: formAction(page, config) });
      const report = await runGate({ model: { page, brief, brand }, versions }, await getRunner(), { onProgress: (step) => (job.step = step) });
      await gates.put(report);
      return { pageId: page.id };
    });
    if (c.req.query("wait") === "true") {
      const finished = await done;
      if (finished.status === "failed") return c.json(finished, 502);
      return c.json(await gates.latest(page.id));
    }
    return c.json(job, 202);
  });
  app.get("/api/pages/:id/gate", async (c) => {
    const page = await mustGetPage(c.req.param("id"));
    const report = await gates.latest(page.id);
    return report ? c.json(report) : c.json({ error: "The checks haven't run on this page yet." }, 404);
  });

  /** What publishing would do now: the files, the risk, and the pull request's description. Writes nothing. */
  const plan = async (page: Page, override?: { reason: string } | null) => {
    const brand = await mustGet(page.brandId);
    const brief = await mustGetBrief(page.briefId);
    const config = await siteConfig(brand);
    const gate = await freshGate(page);
    const result = await planPublish({ page, brand, uiCss: await uiCss(), config, gate, override, targets: targetsOf(brief), read: repo ? repo.read : async () => null, previewUrl: opts.publish?.previewUrl });
    return { brand, brief, config, gate, plan: result };
  };
  const allowOverride = opts.allowOverride ?? true;
  const overrideBody = z.object({ override: z.object({ reason: z.string().trim().min(1, "Say why it's published anyway").max(500) }).optional() });
  /** Why a page can't be published or downloaded now, or null when it can. The override only gets past errors. */
  const refusal = (gate: GateReport | null, override: { reason: string } | null | undefined, action: string): string | null => {
    if (!gate) return "Run the checks on this version of the page first.";
    if (gate.verdict !== "blocked" || override) return null;
    return allowOverride
      ? `The checks found errors. Fix them and run the checks again, or ${action} anyway with a reason.`
      : `The checks found errors. Fix them, run the checks again, then ${action}.`;
  };
  app.get("/api/pages/:id/publish", async (c) => {
    const page = await mustGetPage(c.req.param("id"));
    const { config, gate, plan: p } = await plan(page);
    const { files: _, ...summary } = p;
    const gh = opts.publish?.github;
    return c.json({
      target: gh ? { kind: "github", repo: gh.repo, base: gh.base, reviewers: gh.reviewers ?? [] } : null,
      config,
      gate,
      report: gate ?? (await gates.latest(page.id)),
      plan: summary,
      published: page.published ?? null,
      overrideAllowed: allowOverride,
    });
  });
  app.post("/api/pages/:id/publish", async (c) => {
    const page = await mustGetPage(c.req.param("id"));
    if (!repo) throw new HTTPException(400, { message: "No site repo is connected. Set LPH_GITHUB_REPO and LPH_GITHUB_TOKEN on the server, or download the page for Cloudflare Pages." });
    const body = overrideBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: body.error.issues.map((i) => i.message).join("; ") }, 400);
    const override = allowOverride ? body.data.override : null;
    if (body.data.override && !override) return c.json({ error: "Publishing over the checks is turned off on this server." }, 403);
    const { gate, plan: p } = await plan(page, override);
    const refused = refusal(gate, override, "publish");
    if (refused) return c.json({ error: refused }, 409);
    if (gate!.environment !== "server") return c.json({ error: "The checks have to run on the server before publishing." }, 409);
    if (p.unchanged) return c.json({ error: `${opts.publish!.github!.base} already has this version of the page.` }, 409);
    const result = await repo.publish(p, { expectedHead: page.published?.branch === p.branch ? page.published.commit : null });
    // Not an edit: updatedAt stays, so the checks stay current.
    await pages.save({
      ...page,
      published: { branch: result.branch, commit: result.commit, number: result.number, url: result.url, risk: p.classification.risk, at: new Date().toISOString(), ...(p.override && { override: p.override }) },
    });
    return c.json({ ...result, risk: p.classification.risk, reasons: p.classification.reasons, previews: p.previews, override: p.override }, result.created ? 201 : 200);
  });

  // The fallback: the same files as a folder for Cloudflare Pages, with the form endpoint as a Pages Function.
  app.get("/api/pages/:id/site.zip", async (c) => {
    const page = await mustGetPage(c.req.param("id"));
    const brand = await mustGet(page.brandId);
    const gate = await freshGate(page);
    // ?override=<reason> downloads a page the checks blocked; the reason is kept in its source file.
    const reason = c.req.query("override")?.trim().slice(0, 500);
    if (reason && !allowOverride) return c.json({ error: "Downloading over the checks is turned off on this server." }, 403);
    const refused = refusal(gate, reason ? { reason } : null, "download it");
    if (refused) return c.json({ error: refused }, 409);
    const override = overrideFor(gate, reason ? { reason } : null);
    const bytes = await cloudflareZip({ page, brand, uiCss: await uiCss(), config: await siteConfig(brand), gate, override, targets: targetsOf(await mustGetBrief(page.briefId)) });
    c.header("content-type", "application/zip");
    c.header("content-disposition", `attachment; filename="${page.slug}-cloudflare-pages.zip"`);
    return c.body(bytes);
  });

  // Confirm: write the brand kit.
  app.post("/api/brands/:id/confirm", async (c) => {
    const brand = await mustGet(c.req.param("id"));
    const dir = join(opts.outputDir, slug(brand.name));
    const files = await writeBrandKit(brand, dir);
    return c.json({ dir, files });
  });

  return app;
}
