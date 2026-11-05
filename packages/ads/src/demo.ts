import { readFile } from "node:fs/promises";
import type { Brief } from "@lph/brief";
import type { Page } from "@lph/page";
import type { Brand } from "@lph/tokens";

/** A brand kit, brief and landing page from phases 1 to 3, saved as JSON in one folder. */
export interface DemoInputs {
  brand: Brand;
  brief: Brief;
  page: Page;
}

export async function loadInputs(dir: string | URL): Promise<DemoInputs> {
  const base = typeof dir === "string" ? dir.replace(/\/?$/, "/") : dir.href.replace(/\/?$/, "/");
  const read = async <T>(name: string) => JSON.parse(await readFile(new URL(name, base.startsWith("file:") ? base : `file://${base}`), "utf8")) as T;
  const [brand, brief, page] = await Promise.all([read<Brand>("brand.json"), read<Brief>("brief.json"), read<Page>("page.json")]);
  return { brand, brief, page };
}

/** The Hostinger data the demo and the evals run on: imported from hostinger.com in November 2026. */
export const HOSTINGER = new URL("../demo/hostinger/", import.meta.url);
