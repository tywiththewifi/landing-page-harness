import {
  bestPractices,
  briefEdit,
  briefToMarkdown,
  parsePrompt,
  templateGenerator,
  toBrief,
  type Brief,
  type SeoInsights,
  type SeoProvider,
} from "@lph/brief/browser";
import { generateDesignMd } from "@lph/design-md";
import { renderPreview } from "@lph/kit/preview";
import { checkContrast, resolveConflict, type Brand } from "@lph/tokens";
import uiCss from "@lph/ui/styles.css?raw";
import type { api, Job } from "../api.ts";
import northloop from "./northloop.json";

/**
 * The studio's API, answered in the browser so the demo needs no server. Brand import
 * replays a real extraction of the Northloop fixture (fixtures/northloop, with its URLs
 * moved to northloop.example); everything after that runs the same packages as the
 * server: conflict resolution, contrast, DESIGN.md, the preview, the offline brief
 * writer and the brief checks. Changes are kept in this browser only.
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

  async seoProviders() {
    return providers.map(({ id, name, description }) => ({ id, name, description }));
  },
  async generator() {
    return { name: generator.name, model: null };
  },
  async createBrief(brandId, prompt, seoProvider) {
    const brand = mustGet(brandId);
    if (prompt.trim().length < 3) throw new Error("Describe the page or campaign");
    const provider = providers.find((p) => p.id === (seoProvider ?? providers.at(-1)!.id)) ?? bestPractices;
    return startJob([`Researching keywords with ${provider.name}`, "Writing the brief"], async () => {
      const insights: SeoInsights = await provider.research({ topic: prompt, siteUrl: brand.url, lang: brand.content?.[0]?.lang ?? "en" });
      const content = await generator.generate({ prompt, brand, insights });
      const brief = toBrief(content, { id: crypto.randomUUID(), brandId, prompt, generator, insights });
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
