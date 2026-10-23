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

/**
 * The API as the Node server runs it, configured from the environment (see .env.example).
 * Shared by the HTTP server and the MCP server, which can run the API in its own process.
 */
export function nodeApp(env: NodeJS.ProcessEnv = process.env) {
  // Paths default to the repo root, whichever directory the server is started from.
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const dataDir = resolve(root, env.LPH_DATA_DIR ?? "data");
  const outputDir = resolve(root, env.LPH_OUTPUT_DIR ?? "brands");

  // One browser for the life of the server; a new context per import.
  let browser: Promise<Browser> | null = null;
  const getBrowser = () => (browser ??= launchBrowser());

  const generator = defaultGenerator();
  const pageGenerator = defaultPageGenerator();
  const seoProviders = providersFromEnv();

  // Publishing into the company's site repo, when one is set up.
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
  const allowPrivateUrls = env.LPH_ALLOW_PRIVATE_URLS === "1";

  const app = createApp({
    store: new BrandStore(resolve(dataDir, "brands")),
    briefs: new BriefStore(resolve(dataDir, "briefs")),
    pages: new PageStore(resolve(dataDir, "pages")),
    submissions: new SubmissionStore(resolve(dataDir, "submissions")),
    gates: new GateStore(resolve(dataDir, "gates")),
    gateRunner: async () => serverRunner({ browser: await getBrowser(), ...browserGuard(allowPrivateUrls) }),
    publish: { github: githubTarget, site, previewUrl: env.LPH_PREVIEW_URL },
    generator,
    pageGenerator,
    formSecrets: { webhookSecret: env.LPH_WEBHOOK_SECRET, hubspotToken: env.HUBSPOT_ACCESS_TOKEN },
    seoProviders,
    outputDir,
    allowPrivateUrls,
    allowOverride: env.LPH_PUBLISH_OVERRIDE !== "off",
    extract: async (opts) => extractBrand({ ...opts, browser: await getBrowser() }),
  });

  const summary = [
    `Data: ${dataDir}, brand kits: ${outputDir}.`,
    `Publishing: ${githubTarget ? `pull requests into ${githubTarget.repo} (${githubTarget.base})` : "no repo connected, pages download for Cloudflare Pages"}.`,
    `Briefs: ${generator.name}${generator.model ? ` (${generator.model})` : ""}. Pages: ${pageGenerator.name}. SEO: ${seoProviders.map((p) => p.name).join(", ")}.`,
  ];

  const close = async () => {
    if (browser) await (await browser).close();
  };
  return { app, summary, close };
}
