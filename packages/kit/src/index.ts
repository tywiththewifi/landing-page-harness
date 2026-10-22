import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { generateDesignMd } from "@lph/design-md";
import { toCss, toDtcg, type Brand } from "@lph/tokens";
import { renderPreview } from "./preview.ts";

export { fontLinks, renderPreview } from "./preview.ts";

const require = createRequire(import.meta.url);

export async function uiCss(): Promise<string> {
  return readFile(require.resolve("@lph/ui/styles.css"), "utf8");
}

/** A standalone page that renders the starter components with the brand's tokens. */
export async function previewHtml(brand: Brand): Promise<string> {
  return renderPreview(brand, await uiCss());
}

export interface KitFile {
  path: string;
  contents: string;
}

/** Every file a confirmed brand produces. Used by the API, the CLI and (later) the PR publisher. */
export async function brandKitFiles(brand: Brand): Promise<KitFile[]> {
  const files: KitFile[] = [
    { path: "tokens.css", contents: toCss(brand) },
    { path: "tokens.json", contents: JSON.stringify(toDtcg(brand), null, 2) + "\n" },
    { path: "DESIGN.md", contents: generateDesignMd(brand) },
    { path: "brand.json", contents: JSON.stringify(brand, null, 2) + "\n" },
    { path: "preview.html", contents: await previewHtml(brand) },
  ];
  if (brand.logo?.kind === "svg" && brand.logo.svg) {
    const svg = brand.logo.svg.includes("xmlns=")
      ? brand.logo.svg
      : brand.logo.svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    files.push({ path: "logo.svg", contents: svg + "\n" });
  }
  return files;
}

export async function writeBrandKit(brand: Brand, dir: string): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const files = await brandKitFiles(brand);
  for (const f of files) await writeFile(join(dir, f.path), f.contents);
  return files.map((f) => join(dir, f.path));
}
