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
  defaultGenerator,
  GenerationError,
  toBrief,
  type Brief,
  type BriefGenerator,
  type SeoInsights,
  type SeoProvider,
} from "@lph/brief";
import { generateDesignMd } from "@lph/design-md";
import { extractBrand, type ExtractOptions } from "@lph/extractor";
import { previewHtml, writeBrandKit } from "@lph/kit";
import { checkContrast, resolveConflict, toCss, toDtcg, type Brand } from "@lph/tokens";
import { openApi } from "./openapi.ts";
import type { BrandStore, BriefStore } from "./store.ts";
import { assertPublicUrl, UrlRejected } from "./url-guard.ts";

export interface Job {
  id: string;
  status: "running" | "done" | "failed";
  step: string;
  brandId?: string;
  briefId?: string;
  error?: string;
}

export interface AppOptions {
  store: BrandStore;
  briefs: BriefStore;
  /** Writes briefs. Defaults to Claude when credentials are set, the offline template otherwise. */
  generator?: BriefGenerator;
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
});

const briefRequest = z.object({
  prompt: z.string().trim().min(3, "Describe the page or campaign").max(2000),
  seoProvider: z.string().optional(),
});

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brand";

export function createApp(opts: AppOptions) {
  const { store, briefs } = opts;
  const extract = opts.extract ?? extractBrand;
  const generator = opts.generator ?? defaultGenerator();
  const providers = opts.seoProviders?.length ? opts.seoProviders : [bestPractices];
  const jobs = new Map<string, Job>();
  const app = new Hono();

  app.use("/api/*", cors());

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    if (err instanceof UrlRejected) return c.json({ error: err.message }, 400);
    if (err instanceof GenerationError) return c.json({ error: err.message }, 502);
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
      const brand = await extract({ ...input, onProgress: (step) => (job.step = step) });
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
  const startBrief = (brand: Brand, prompt: string, provider: SeoProvider) =>
    runJob(async (job) => {
      job.step = `Researching keywords with ${provider.name}`;
      const insights = await research(provider, { topic: prompt, siteUrl: brand.url, lang: brand.content?.[0]?.lang ?? "en" });
      job.step = "Writing the brief";
      const content = await generator.generate({ prompt, brand, insights });
      const brief = toBrief(content, { id: crypto.randomUUID(), brandId: brand.id, prompt, generator, insights });
      await briefs.save(brief);
      return { brandId: brand.id, briefId: brief.id };
    });

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/api/openapi.json", (c) => c.json(openApi));

  app.get("/api/brands", async (c) => c.json(await store.list()));
  app.get("/api/seo/providers", (c) => c.json(providers.map(({ id, name, description }) => ({ id, name, description }))));
  app.get("/api/generator", (c) => c.json({ name: generator.name, model: generator.model ?? null }));

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
    const edit = brandEdit.parse(await c.req.json());
    const next: Brand = {
      ...current,
      ...(edit as unknown as Partial<Brand>),
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

  // Phase 2: a prompt becomes a marketing brief grounded in the brand's site.
  app.post("/api/brands/:id/briefs", async (c) => {
    const brand = await mustGet(c.req.param("id"));
    const body = briefRequest.parse(await c.req.json());
    // A connected tool, when there is one, is the default over best practices.
    const provider = providers.find((p) => p.id === (body.seoProvider ?? providers.at(-1)!.id));
    if (!provider) throw new HTTPException(400, { message: `Unknown SEO provider "${body.seoProvider}"` });
    const { job, done } = startBrief(brand, body.prompt, provider);
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

  // Confirm: write the brand kit. In M4 this becomes a pull request into the company's repo.
  app.post("/api/brands/:id/confirm", async (c) => {
    const brand = await mustGet(c.req.param("id"));
    const dir = join(opts.outputDir, slug(brand.name));
    const files = await writeBrandKit(brand, dir);
    return c.json({ dir, files });
  });

  return app;
}
