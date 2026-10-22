import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { join } from "node:path";
import { z } from "zod";
import { generateDesignMd } from "@lph/design-md";
import { extractBrand, type ExtractOptions } from "@lph/extractor";
import { previewHtml, writeBrandKit } from "@lph/kit";
import { checkContrast, resolveConflict, toCss, toDtcg, type Brand } from "@lph/tokens";
import { openApi } from "./openapi.ts";
import type { BrandStore } from "./store.ts";
import { assertPublicUrl, UrlRejected } from "./url-guard.ts";

export interface Job {
  id: string;
  status: "running" | "done" | "failed";
  step: string;
  brandId?: string;
  error?: string;
}

export interface AppOptions {
  store: BrandStore;
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

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brand";

export function createApp(opts: AppOptions) {
  const { store } = opts;
  const extract = opts.extract ?? extractBrand;
  const jobs = new Map<string, Job>();
  const app = new Hono();

  app.use("/api/*", cors());

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    if (err instanceof UrlRejected) return c.json({ error: err.message }, 400);
    if (err instanceof z.ZodError) return c.json({ error: "Invalid request", issues: err.issues }, 400);
    console.error(err);
    return c.json({ error: "Something went wrong" }, 500);
  });

  const mustGet = async (id: string) => {
    const brand = await store.get(id).catch(() => null);
    if (!brand) throw new HTTPException(404, { message: "Brand not found" });
    return brand;
  };

  /** Runs an extraction in the background and tracks it as a job. */
  const startJob = (input: ExtractOptions, keepId?: string) => {
    const job: Job = { id: crypto.randomUUID(), status: "running", step: "Starting" };
    jobs.set(job.id, job);
    const done = (async () => {
      try {
        const brand = await extract({ ...input, onProgress: (step) => (job.step = step) });
        if (keepId) brand.id = keepId;
        await store.save(brand);
        Object.assign(job, { status: "done", step: "Done", brandId: brand.id });
      } catch (err) {
        Object.assign(job, { status: "failed", error: err instanceof Error ? err.message : String(err) });
      }
      return job;
    })();
    return { job, done };
  };

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/api/openapi.json", (c) => c.json(openApi));

  app.get("/api/brands", async (c) => c.json(await store.list()));

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
