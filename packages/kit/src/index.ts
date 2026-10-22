import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { generateDesignMd } from "@lph/design-md";
import { toCss, toDtcg, type Brand } from "@lph/tokens";
import { BrandPreview } from "@lph/ui";

const require = createRequire(import.meta.url);

export async function uiCss(): Promise<string> {
  return readFile(require.resolve("@lph/ui/styles.css"), "utf8");
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function fontLinks(brand: Brand): string {
  return brand.fontSources.stylesheets.map((href) => `<link rel="stylesheet" href="${escapeAttr(href)}">`).join("\n");
}

/** A standalone page that renders the starter components with the brand's tokens. */
export async function previewHtml(brand: Brand): Promise<string> {
  const body = renderToStaticMarkup(createElement(BrandPreview, { brand }));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${brand.name} brand preview</title>
${fontLinks(brand)}
<style>
body { margin: 0; }
${brand.fontSources.faces.join("\n")}
${toCss(brand)}
${await uiCss()}
</style>
</head>
<body>
${body}
</body>
</html>
`;
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
