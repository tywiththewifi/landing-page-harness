import { serve } from "@hono/node-server";
import type { Browser } from "playwright";
import { extractBrand, launchBrowser } from "@lph/extractor";
import { createPublicApp } from "./public.ts";

// The public import service for the online demo (see public.ts). Hugging Face Spaces
// expect port 7860; other hosts set PORT.
const port = Number(process.env.PORT ?? 7860);
const env = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

let browser: Promise<Browser> | null = null;
const getBrowser = () => (browser ??= launchBrowser());

const app = createPublicApp({
  extract: async (opts) => extractBrand({ ...opts, browser: await getBrowser() }),
  origins: process.env.LPH_CORS_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean),
  importsPerHour: env("LPH_IMPORTS_PER_HOUR", 10),
  importsPerHourTotal: env("LPH_IMPORTS_PER_HOUR_TOTAL", 200),
  mcpCallsPerHour: env("LPH_MCP_CALLS_PER_HOUR", 60),
  maxConcurrent: env("LPH_MAX_CONCURRENT", 2),
});

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => console.log(`Public import service on :${port}`));

const shutdown = async () => {
  if (browser) await (await browser).close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
