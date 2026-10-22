import {
  bestPractices,
  briefEdit,
  briefToMarkdown,
  describeTool,
  parsePrompt,
  templateGenerator,
  toBrief,
  toolUse,
  type Brief,
  type SeoInsights,
  type SeoProvider,
  type SiteData,
  type ToolInfo,
} from "@lph/brief/browser";
import { generateDesignMd } from "@lph/design-md";
import { renderPreview } from "@lph/kit/preview";
import { checkContrast, resolveConflict, type Brand, type SiteMcp } from "@lph/tokens";
import uiCss from "@lph/ui/styles.css?raw";
import type { api, Job } from "../api.ts";
import sampleMcp from "../../../../fixtures/northloop/mcp.json";
import northloop from "./northloop.json";

/**
 * The studio's API, answered in the browser so the demo needs no server. Brand import
 * replays a real extraction of the Northloop fixture (fixtures/northloop, with its URLs
 * moved to northloop.example); everything after that runs the same packages as the
 * server: conflict resolution, contrast, DESIGN.md, the preview, the offline brief
 * writer and the brief checks. The site's MCP server is the fixture's (mcp.json),
 * answered here the way scripts/serve-fixture.mjs answers it. Changes are kept in
 * this browser only.
 */

const SAMPLE = northloop as unknown as Brand;
const KEY = "lph-demo";

interface State {
  brands: Record<string, Brand>;
  briefs: Record<string, Brief>;
}

function load(): State {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as State | null;
    if (saved?.brands && saved.briefs) return saved;
  } catch {
    // Storage can be blocked or hold something else; start fresh.
  }
  return { brands: {}, briefs: {} };
}

let state = load();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Without storage the demo still works; changes last until the page is closed.
  }
}

export function resetDemo() {
  state = { brands: {}, briefs: {} };
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}

const now = () => new Date().toISOString();

function mustGet(id: string): Brand {
  const brand = state.brands[id];
  if (!brand) throw new Error("Brand not found");
  return brand;
}

function mustGetBrief(id: string): Brief {
  const brief = state.briefs[id];
  if (!brief) throw new Error("Brief not found");
  return brief;
}

function saveBrand(brand: Brand): Brand {
  state.brands[brand.id] = brand;
  persist();
  return brand;
}

/** Jobs step through their stages on a timer, like the server's jobs, so the progress UI shows. */
const jobs = new Map<string, { job: Job; steps: string[]; started: number; finish: () => Promise<Partial<Job>> }>();
const STEP_MS = 700;

function startJob(steps: string[], finish: () => Promise<Partial<Job>>): Job {
  const job: Job = { id: crypto.randomUUID(), status: "running", step: steps[0]! };
  jobs.set(job.id, { job, steps, started: Date.now(), finish });
  return { ...job };
}

async function advance(id: string): Promise<Job> {
  const entry = jobs.get(id);
  if (!entry) throw new Error("Job not found");
  const { job, steps, started, finish } = entry;
  if (job.status !== "running") return { ...job };
  const i = Math.floor((Date.now() - started) / STEP_MS);
  if (i < steps.length) return { ...job, step: steps[i]! };
  try {
    Object.assign(job, { status: "done", step: "Done", ...(await finish()) });
  } catch (err) {
    Object.assign(job, { status: "failed", error: (err as Error).message });
  }
  return { ...job };
}

const importSteps = (brand: Brand) => {
  const [home, product] = brand.pages.map((p) => p.replace(/^https?:\/\//, "").replace(/\/$/, ""));
  return [`Reading the home page (${home})`, `Reading the product page (${product})`, "Checking mobile type sizes", "Building the design system"];
};

/** A fresh copy of the sample, as if the extractor had just measured it. */
const importSample = () => saveBrand({ ...structuredClone(SAMPLE), createdAt: now(), updatedAt: now() });

/**
 * Stands in for a connected SEO tool, so the demo shows what one adds. The numbers are
 * made up from the topic and labelled as such.
 */
const sampleSeo: SeoProvider = {
  id: "sample",
  name: "Sample SEO data (demo)",
  description: "Made-up keyword volumes and questions, to show what a connected tool adds. Not real data.",
  async research({ topic }) {
    const t = parsePrompt(topic).topic.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim();
    const seed = [...t].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 9973, 7);
    const volume = (i: number) => Math.round(([1900, 880, 720, 480, 320, 210][i]! * (0.6 + (seed % 80) / 100)) / 10) * 10;
    const terms = [t, `${t} software`, `best ${t}`, `${t} pricing`, `${t} for small teams`, `${t} alternatives`];
    return {
      provider: "sample",
      keywords: terms.map((term, i) => ({ term, volume: volume(i), difficulty: ((seed + i * 17) % 60) + 15, intent: i === 3 ? "transactional" : "commercial" })),
      questions: [`What is ${t}?`, `How long does ${t} take to set up?`, `How much does ${t} cost?`, `Is ${t} secure?`],
      notes: ["Demo data: these volumes are invented to show the layout. Connect a real tool for actual numbers."],
    };
  },
};

const providers = [bestPractices, sampleSeo];

type SampleTool = ToolInfo & { text: string; articles?: { title: string; text: string }[] };
const MCP_TOOLS = sampleMcp.tools as unknown as SampleTool[];
const MCP_URL = "https://northloop.example/mcp";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What inspecting the sample server returns, with the tools a person allowed. */
const inspectSample = (allowed: string[]): SiteMcp => ({
  url: MCP_URL,
  name: sampleMcp.server.title,
  version: sampleMcp.server.version,
  tools: MCP_TOOLS.map((t) => describeTool(t, allowed)),
  resources: sampleMcp.resources.map(({ uri, name }) => ({ uri, name })),
  allowed: allowed.filter((n) => MCP_TOOLS.some((t) => t.name === n)),
  checkedAt: now(),
});

/** The same calls the server's collectSiteData makes, answered from the sample. */
function collectSample(topic: string, allowed: string[]): SiteData {
  const usable = MCP_TOOLS.map((t) => ({ t, ...toolUse(t, allowed.includes(t.name)) })).filter((x) => x.use);
  const facts = usable.map(({ t }) => {
    let text = t.text;
    if (t.articles) {
      const words = topic.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
      const hits = t.articles.filter((a) => words.some((w) => `${a.title} ${a.text}`.toLowerCase().includes(w)));
      text = (hits.length ? hits : t.articles.slice(0, 2)).map((a) => `${a.title}: ${a.text}`).join("\n");
    }
    return { source: `tool:${t.name}`, label: t.title ?? t.name, text };
  });
  facts.push(...sampleMcp.resources.map((r) => ({ source: `resource:${r.uri}`, label: r.name, text: r.text })));
  const skipped = MCP_TOOLS.length - usable.length;
  return {
    server: { name: sampleMcp.server.title, url: MCP_URL },
    facts,
    notes: skipped ? [`${skipped} tool${skipped === 1 ? " was" : "s were"} skipped: not read-only, or ${skipped === 1 ? "it needs" : "they need"} inputs the harness can't fill.`] : [],
  };
}
const generator = templateGenerator();

export const demoApi: typeof api = {
  async listBrands() {
    return Object.values(state.brands)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, name, url, updatedAt }) => ({ id, name, url, updatedAt }));
  },
  async importBrand() {
    return startJob(importSteps(SAMPLE), async () => ({ brandId: importSample().id }));
  },
  job: advance,
  async brand(id) {
    return mustGet(id);
  },
  async save(brand) {
    const current = mustGet(brand.id);
    return saveBrand({ ...brand, id: current.id, url: current.url, pages: current.pages, createdAt: current.createdAt, updatedAt: now() });
  },
  async resolve(id, conflictId, value) {
    return saveBrand({ ...resolveConflict(mustGet(id), conflictId, value), updatedAt: now() });
  },
  async retry(id) {
    const brand = mustGet(id);
    return startJob(importSteps(brand), async () => ({ brandId: importSample().id }));
  },
  async designMd(id) {
    return generateDesignMd(mustGet(id));
  },
  async contrast(id) {
    return checkContrast(mustGet(id));
  },
  async confirm(id) {
    const brand = mustGet(id);
    const files = ["tokens.css", "tokens.json", "DESIGN.md", "brand.json", "preview.html", ...(brand.logo?.kind === "svg" ? ["logo.svg"] : [])];
    return { dir: `brands/${brand.id}`, files: files.map((f) => `brands/${brand.id}/${f}`) };
  },
  async previewHtml(id) {
    return renderPreview(mustGet(id), uiCss);
  },
  async connectSiteMcp(id) {
    const brand = mustGet(id);
    await pause(600);
    return saveBrand({ ...brand, siteMcp: inspectSample([]) });
  },
  async allowSiteTools(id, allowed) {
    const brand = mustGet(id);
    if (!brand.siteMcp) throw new Error("No MCP server is connected");
    return saveBrand({ ...brand, siteMcp: inspectSample(allowed) });
  },
  async disconnectSiteMcp(id) {
    const { siteMcp: _, ...brand } = mustGet(id);
    return saveBrand(brand);
  },

  async seoProviders() {
    return providers.map(({ id, name, description }) => ({ id, name, description }));
  },
  async generator() {
    return { name: generator.name, model: null };
  },
  async createBrief(brandId, prompt, seoProvider, useSiteData = true) {
    const brand = mustGet(brandId);
    if (prompt.trim().length < 3) throw new Error("Describe the page or campaign");
    const provider = providers.find((p) => p.id === (seoProvider ?? providers.at(-1)!.id)) ?? bestPractices;
    const mcp = useSiteData ? brand.siteMcp : undefined;
    const steps = [...(mcp ? [`Reading site data from ${mcp.name}`] : []), `Researching keywords with ${provider.name}`, "Writing the brief"];
    return startJob(steps, async () => {
      const siteData = mcp ? collectSample(parsePrompt(prompt).topic, mcp.allowed) : undefined;
      const insights: SeoInsights = await provider.research({ topic: prompt, siteUrl: brand.url, lang: brand.content?.[0]?.lang ?? "en" });
      const content = await generator.generate({ prompt, brand, insights, siteData });
      const brief = toBrief(content, { id: crypto.randomUUID(), brandId, prompt, generator, insights, siteData });
      state.briefs[brief.id] = brief;
      persist();
      return { brandId, briefId: brief.id };
    });
  },
  async listBriefs(brandId) {
    return Object.values(state.briefs)
      .filter((b) => b.brandId === brandId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, title, prompt, funnelStage, updatedAt }) => ({ id, title, prompt, funnelStage, updatedAt }));
  },
  async brief(id) {
    return mustGetBrief(id);
  },
  async saveBrief(brief) {
    // Same rule as the server: the prompt, ids and keyword data stay as stored.
    const current = mustGetBrief(brief.id);
    const next: Brief = { ...current, ...briefEdit.parse(brief), updatedAt: now() };
    state.briefs[next.id] = next;
    persist();
    return next;
  },
  async briefMd(id) {
    return briefToMarkdown(mustGetBrief(id));
  },
};
