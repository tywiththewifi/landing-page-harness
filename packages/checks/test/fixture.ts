import { readFile } from "node:fs/promises";
import { PLACEHOLDER, bestPractices, templateGenerator, toBrief, type Brief } from "@lph/brief";
import { templatePageGenerator, toPage, type Page } from "@lph/page";
import type { Brand } from "@lph/tokens";
import northloop from "../../../apps/studio/src/demo/northloop.json";

export const brand = northloop as unknown as Brand;
export const uiCss = () => readFile(new URL("../../ui/src/styles.css", import.meta.url), "utf8");
const prompt = "A landing page for our new HubSpot integration aimed at RevOps leads at SaaS companies";

export async function makeBrief(): Promise<Brief> {
  const insights = await bestPractices.research({ topic: prompt, siteUrl: brand.url, lang: "en" });
  const gen = templateGenerator();
  const brief = toBrief(await gen.generate({ prompt, brand, insights }), { id: "brief-1", brandId: brand.id, prompt, generator: gen, insights });
  brief.personas[0] = { ...brief.personas[0]!, motivations: ["Stop rebuilding the same workflows every quarter"], pains: ["Leads sit unrouted while the team waits on engineering"] };
  return brief;
}

/** A built page with every placeholder written and leads going to HubSpot, as a marketer would leave it. */
export async function finishedPage(): Promise<{ page: Page; brief: Brief }> {
  const brief = await makeBrief();
  const gen = templatePageGenerator();
  const page = toPage(await gen.generate({ brief, brand }), { id: "page-1", brief, generator: gen, now: new Date("2026-10-22T08:00:00Z") });
  const fill = (v: unknown): unknown =>
    typeof v === "string" ? (v.includes(PLACEHOLDER) ? "Written by a person" : v) : Array.isArray(v) ? v.map(fill) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v;
  page.blocks = fill(page.blocks) as Page["blocks"];
  page.variants = fill(page.variants) as Page["variants"];
  page.form = { connector: "hubspot", webhookUrl: "", hubspotPortalId: "123456", hubspotFormId: "0e295a5b-85c8-4061-a36f-eb1f0749b877" };
  return { page, brief };
}
