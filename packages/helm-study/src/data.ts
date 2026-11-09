/** The snapshots this package works from, so tests and builds never need the network. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PageAdoption } from "./adoption.ts";
import type { Measurement } from "./measure.ts";
import type { TokenDef, TokenGraph } from "./tokens.ts";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA = join(ROOT, "data");

export interface Snapshot<T> {
  /** ISO date the live site was read. */
  takenAt: string;
  source: string;
  data: T;
}

export interface GraphJson {
  prefix: string;
  defs: TokenDef[];
  uses: Record<string, number>;
  bare: string[];
}

export const toJson = (g: TokenGraph): GraphJson => ({ prefix: g.prefix, defs: g.defs, uses: Object.fromEntries(g.uses), bare: [...g.bare].sort() });
export const fromJson = (j: GraphJson): TokenGraph => ({ prefix: j.prefix, defs: j.defs, uses: new Map(Object.entries(j.uses)), bare: new Set(j.bare) });

function read<T>(file: string): Snapshot<T> {
  return JSON.parse(readFileSync(join(DATA, file), "utf8")) as Snapshot<T>;
}
export function write(file: string, value: unknown) {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(join(DATA, file), JSON.stringify(value, null, 1) + "\n");
}

export const loadGraph = () => {
  const s = read<GraphJson>("helm-tokens.json");
  return { ...s, graph: fromJson(s.data) };
};
export const loadAdoption = () => read<PageAdoption[]>("adoption.json");
export const loadLive = () => read<Measurement[]>("live-components.json");
