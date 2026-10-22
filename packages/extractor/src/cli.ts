#!/usr/bin/env -S npx tsx
/**
 * lph-extract <url> [--product <url>] [--out <dir>]
 *
 * Samples the home page and main product page and writes the brand kit
 * (tokens.css, tokens.json, DESIGN.md, brand.json, preview.html).
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { writeBrandKit } from "@lph/kit";
import { extractBrand } from "./extract.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    product: { type: "string" },
    out: { type: "string" },
  },
});

const url = positionals[0];
if (!url) {
  console.error("Usage: lph-extract <url> [--product <url>] [--out <dir>]");
  process.exit(1);
}

const brand = await extractBrand({
  url,
  productUrl: values.product,
  onProgress: (step) => console.error(`• ${step}`),
});
const dir = resolve(values.out ?? `brands/${brand.id}`);
const files = await writeBrandKit(brand, dir);

console.error(`\n${brand.name}: ${brand.colors.length} colours, ${brand.typography.length} type tokens, ${brand.buttons.length} button styles, ${brand.cards.length} card styles`);
for (const c of brand.conflicts) console.error(`! ${c.message}`);
for (const w of brand.warnings) console.error(`! ${w}`);
console.error(`\nWrote:\n${files.map((f) => `  ${f}`).join("\n")}`);
