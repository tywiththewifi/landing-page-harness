import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ROOT } from "./data.ts";

export const TOKENS_CSS = join(ROOT, "src/components/tokens.css");
export const COMPONENTS_CSS = join(ROOT, "src/components/components.css");

export const css = () => (existsSync(TOKENS_CSS) ? readFileSync(TOKENS_CSS, "utf8") : "") + "\n" + readFileSync(COMPONENTS_CSS, "utf8");

/**
 * Inter, inlined, so screenshots come out the same on any machine. Söhne, Stripe's
 * typeface, is licensed and isn't used here.
 */
export function interFontFace(): string {
  const require = createRequire(import.meta.url);
  const dir = join(require.resolve("@fontsource/inter/package.json"), "..", "files");
  return [400, 500]
    .map((w) => {
      const data = readFileSync(join(dir, `inter-latin-${w}-normal.woff2`)).toString("base64");
      return `@font-face{font-family:"Inter";font-weight:${w};font-style:normal;src:url(data:font/woff2;base64,${data}) format("woff2");}`;
    })
    .join("\n");
}

export interface PageOptions {
  title: string;
  /** Inline Inter. Tests do; the docs page does too, so it looks the same everywhere. */
  font?: boolean;
  extraCss?: string;
}

export function pageHtml(body: ReactNode, opts: PageOptions): string {
  const markup = renderToStaticMarkup(<>{body}</>);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title}</title>
<style>
${opts.font === false ? "" : interFontFace()}
${css()}
${opts.extraCss ?? ""}
</style>
</head>
<body>
${markup}
</body>
</html>
`;
}
