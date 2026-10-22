import { serve } from "@hono/node-server";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser } from "playwright";
import { extractBrand, launchBrowser } from "@lph/extractor";
import { createApp } from "./app.ts";
import { BrandStore } from "./store.ts";

const port = Number(process.env.PORT ?? 8787);
// Paths default to the repo root, whichever directory the server is started from.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const dataDir = resolve(root, process.env.LPH_DATA_DIR ?? "data/brands");
const outputDir = resolve(root, process.env.LPH_OUTPUT_DIR ?? "brands");

// One browser for the life of the server; a new context per import.
let browser: Promise<Browser> | null = null;
const getBrowser = () => (browser ??= launchBrowser());

const app = createApp({
  store: new BrandStore(dataDir),
  outputDir,
  extract: async (opts) => extractBrand({ ...opts, browser: await getBrowser() }),
});

serve({ fetch: app.fetch, port }, () => {
  console.log(`API on http://localhost:${port} (data: ${dataDir}, output: ${outputDir})`);
});

const shutdown = async () => {
  if (browser) await (await browser).close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
