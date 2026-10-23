import { serve } from "@hono/node-server";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser } from "playwright";
import { defaultGenerator, providersFromEnv } from "@lph/brief";
import { serverRunner } from "@lph/checks";
import { extractBrand, launchBrowser } from "@lph/extractor";
import { defaultPageGenerator } from "@lph/page";
import { createApp } from "./app.ts";
import { BrandStore, BriefStore, GateStore, PageStore, SubmissionStore } from "./store.ts";
import { browserGuard } from "./url-guard.ts";

const port = Number(process.env.PORT ?? 8787);
// Paths default to the repo root, whichever directory the server is started from.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const dataDir = resolve(root, process.env.LPH_DATA_DIR ?? "data");
const outputDir = resolve(root, process.env.LPH_OUTPUT_DIR ?? "brands");

// One browser for the life of the server; a new context per import.
let browser: Promise<Browser> | null = null;
const getBrowser = () => (browser ??= launchBrowser());

const generator = defaultGenerator();
const pageGenerator = defaultPageGenerator();
const seoProviders = providersFromEnv();

// Publishing into the company's site repo, when one is set up.
const env = process.env;
const githubTarget =
  env.LPH_GITHUB_REPO && env.LPH_GITHUB_TOKEN
    ? {
        repo: env.LPH_GITHUB_REPO,
        token: env.LPH_GITHUB_TOKEN,
        base: env.LPH_GITHUB_BASE || "main",
        reviewers: env.LPH_GITHUB_REVIEWERS?.split(",").map((r) => r.trim()).filter(Boolean),
        // GitHub Enterprise Server: https://github.example.com/api/v3
        apiUrl: env.LPH_GITHUB_API_URL || undefined,
      }
    : undefined;
const site = {
  ...(env.LPH_SITE_ORIGIN && { origin: env.LPH_SITE_ORIGIN.replace(/\/+$/, "") }),
  ...(env.LPH_FORM_ENDPOINT && { formEndpoint: env.LPH_FORM_ENDPOINT.replace(/\/+$/, "") }),
};

const app = createApp({
  store: new BrandStore(resolve(dataDir, "brands")),
  briefs: new BriefStore(resolve(dataDir, "briefs")),
  pages: new PageStore(resolve(dataDir, "pages")),
  submissions: new SubmissionStore(resolve(dataDir, "submissions")),
  gates: new GateStore(resolve(dataDir, "gates")),
  gateRunner: async () => serverRunner({ browser: await getBrowser(), ...browserGuard() }),
  publish: { github: githubTarget, site, previewUrl: env.LPH_PREVIEW_URL },
  generator,
  pageGenerator,
  formSecrets: { webhookSecret: process.env.LPH_WEBHOOK_SECRET, hubspotToken: process.env.HUBSPOT_ACCESS_TOKEN },
  seoProviders,
  outputDir,
  extract: async (opts) => extractBrand({ ...opts, browser: await getBrowser() }),
});

serve({ fetch: app.fetch, port }, () => {
  console.log(`API on http://localhost:${port} (data: ${dataDir}, output: ${outputDir})`);
  console.log(`Publishing: ${githubTarget ? `pull requests into ${githubTarget.repo} (${githubTarget.base})` : "no repo connected, pages download for Cloudflare Pages"}.`);
  console.log(`Briefs: ${generator.name}${generator.model ? ` (${generator.model})` : ""}. Pages: ${pageGenerator.name}. SEO: ${seoProviders.map((p) => p.name).join(", ")}.`);
});

const shutdown = async () => {
  if (browser) await (await browser).close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
