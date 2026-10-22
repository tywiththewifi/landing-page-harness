import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { collectSiteData, inspectMcp } from "@lph/brief";
import type { ExtractOptions } from "@lph/extractor";
import type { Brand } from "@lph/tokens";
import type { Job } from "./app.ts";
import { assertPublicUrl, browserGuard, UrlRejected } from "./url-guard.ts";

/**
 * The public import service behind the online demo. It does only what a browser can't:
 * open a site in a headless browser, and talk to a site's MCP server. It keeps nothing:
 * a finished import is handed back once and forgotten. Everything else (review, briefs,
 * checks) runs in the visitor's browser.
 */
export interface PublicOptions {
  extract: (opts: ExtractOptions) => Promise<Brand>;
  /** Origins allowed to call the service from a browser. ["*"] allows any. */
  origins?: string[];
  allowPrivateUrls?: boolean;
  /** Per visitor (IP) and hour. */
  importsPerHour?: number;
  /** For everyone together, per hour: the hard cap on what the service spends. */
  importsPerHourTotal?: number;
  mcpCallsPerHour?: number;
  /** Imports running at once; the rest wait their turn. */
  maxConcurrent?: number;
  importTimeoutMs?: number;
  now?: () => number;
}

interface PublicJob extends Job {
  brand?: Brand;
  finishedAt?: number;
}

const importBody = z.object({ url: z.string().min(1).max(2000), productUrl: z.string().max(2000).optional(), id: z.string().regex(/^[a-z0-9-]{1,80}$/).optional() });
const mcpBody = z.object({ url: z.string().min(1).max(2000), allowed: z.array(z.string().max(200)).max(50).default([]) });
const collectBody = mcpBody.extend({ topic: z.string().trim().min(1).max(200) });

const KEEP_FINISHED_MS = 10 * 60_000;

export function createPublicApp(opts: PublicOptions) {
  const now = opts.now ?? Date.now;
  const importsPerHour = opts.importsPerHour ?? 10;
  const importsPerHourTotal = opts.importsPerHourTotal ?? 200;
  const mcpCallsPerHour = opts.mcpCallsPerHour ?? 60;
  const maxConcurrent = opts.maxConcurrent ?? 2;
  const jobs = new Map<string, PublicJob>();
  const queue: (() => void)[] = [];
  let running = 0;
  const app = new Hono();

  app.use("/api/*", cors({ origin: opts.origins?.length ? opts.origins : "*", allowMethods: ["GET", "POST"] }));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    if (err instanceof UrlRejected) return c.json({ error: err.message }, 400);
    if (err instanceof z.ZodError) return c.json({ error: "Invalid request" }, 400);
    console.error(err);
    return c.json({ error: "Something went wrong" }, 500);
  });

  // Sliding windows of an hour. Behind a proxy (Cloud Run, most hosts) the first
  // x-forwarded-for entry is the visitor. A visitor can forge it, so the per-visitor
  // limit is a courtesy and the total is the real cap.
  const hits = new Map<string, number[]>();
  const recent = (key: string) => (hits.get(key) ?? []).filter((h) => now() - h < 3_600_000);
  /** Counts a call against every rule, or refuses it with the first rule that's used up. */
  const limit = (...rules: { key: string; max: number; message: string }[]) => {
    const full = rules.find((r) => recent(r.key).length >= r.max);
    if (full) throw new HTTPException(429, { message: full.message });
    for (const r of rules) hits.set(r.key, [...recent(r.key), now()]);
  };
  const perVisitor = (key: string, max: number, what: string) => ({
    key,
    max,
    message: `The demo allows ${max} ${what} an hour per visitor. Try again later, or run the harness locally.`,
  });
  const visitor = (header: string | undefined) => header?.split(",")[0]?.trim() || "unknown";

  // Finished jobs are dropped after a while, so nothing about a visit is kept.
  const sweep = () => {
    for (const [id, job] of jobs) if (job.finishedAt && now() - job.finishedAt > KEEP_FINISHED_MS) jobs.delete(id);
    for (const key of hits.keys()) if (!recent(key).length) hits.delete(key);
  };

  const withTimeout = <T,>(work: Promise<T>, ms: number) =>
    Promise.race([work, new Promise<never>((_, fail) => setTimeout(() => fail(new Error("The site took too long to load.")), ms))]);

  const start = (input: ExtractOptions, keepId?: string): PublicJob => {
    sweep();
    const job: PublicJob = { id: crypto.randomUUID(), status: "running", step: "Starting" };
    jobs.set(job.id, job);
    const run = async () => {
      running++;
      try {
        const brand = await withTimeout(
          opts.extract({ timeoutMs: 30_000, ...input, ...browserGuard(opts.allowPrivateUrls), onProgress: (step) => (job.step = step) }),
          opts.importTimeoutMs ?? 120_000,
        );
        if (keepId) brand.id = keepId;
        Object.assign(job, { status: "done", step: "Done", brandId: brand.id, brand });
      } catch (err) {
        Object.assign(job, { status: "failed", error: err instanceof Error ? err.message : String(err) });
      } finally {
        job.finishedAt = now();
        running--;
        queue.shift()?.();
      }
    };
    if (running < maxConcurrent) void run();
    else {
      job.step = `Waiting for a free browser (${queue.length + 1} ahead)`;
      queue.push(() => void run());
    }
    return job;
  };

  app.get("/api/health", (c) => c.json({ ok: true, mode: "public", importsPerHour }));

  app.post("/api/brands", async (c) => {
    const body = importBody.parse(await c.req.json());
    const url = await assertPublicUrl(body.url, opts.allowPrivateUrls);
    const productUrl = body.productUrl ? await assertPublicUrl(body.productUrl, opts.allowPrivateUrls) : undefined;
    limit(perVisitor(`import:${visitor(c.req.header("x-forwarded-for"))}`, importsPerHour, "imports"), {
      key: "import:all",
      max: importsPerHourTotal,
      message: "The demo has run all the imports it can this hour. Try again later, or run the harness locally.",
    });
    const { brand: _, ...job } = start({ url: url.href, productUrl: productUrl?.href }, body.id);
    return c.json(job, 202);
  });

  // The brand comes back with the finished job, and the job is then forgotten.
  app.get("/api/jobs/:id", (c) => {
    const job = jobs.get(c.req.param("id"));
    if (!job) return c.json({ error: "Job not found" }, 404);
    if (job.status !== "running") jobs.delete(job.id);
    const { finishedAt: _, ...rest } = job;
    return c.json(rest);
  });

  // A site's MCP server, for the Site data panel. Same rules as the full API: read-only tools only.
  app.post("/api/site-mcp/inspect", async (c) => {
    const body = mcpBody.parse(await c.req.json());
    const url = await assertPublicUrl(body.url, opts.allowPrivateUrls);
    limit(perVisitor(`mcp:${visitor(c.req.header("x-forwarded-for"))}`, mcpCallsPerHour, "MCP calls"));
    try {
      return c.json(await inspectMcp(url.href, { allowed: body.allowed, timeoutMs: 15_000 }));
    } catch (err) {
      throw new HTTPException(502, { message: `Couldn't connect to an MCP server at ${url.href} (${(err as Error).message}).` });
    }
  });
  app.post("/api/site-mcp/collect", async (c) => {
    const body = collectBody.parse(await c.req.json());
    const url = await assertPublicUrl(body.url, opts.allowPrivateUrls);
    limit(perVisitor(`mcp:${visitor(c.req.header("x-forwarded-for"))}`, mcpCallsPerHour, "MCP calls"));
    try {
      return c.json(await collectSiteData(url.href, body.topic, { allowed: body.allowed, timeoutMs: 15_000 }));
    } catch (err) {
      throw new HTTPException(502, { message: `Couldn't read the MCP server at ${url.href} (${(err as Error).message}).` });
    }
  });

  return app;
}
