import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { toCss, type Brand } from "@lph/tokens";
import { BrandPreview } from "@lph/ui";

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Site-derived strings end up inside <style>; make sure they can't close it. */
const cssSafe = (css: string) => css.replace(/<\/(style)/gi, "<\\/$1").replace(/<!--/g, "");

export function fontLinks(brand: Brand): string {
  return brand.fontSources.stylesheets.map((href) => `<link rel="stylesheet" href="${escapeAttr(href)}">`).join("\n");
}

/**
 * A standalone page that renders the starter components with the brand's tokens.
 * Takes the components' CSS as an argument so it runs in the browser as well as in Node.
 */
export function renderPreview(brand: Brand, uiCss: string): string {
  const body = renderToStaticMarkup(createElement(BrandPreview, { brand }));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${brand.name} brand preview</title>
${fontLinks(brand)}
<style>
${cssSafe(`body { margin: 0; }
${brand.fontSources.faces.join("\n")}
${toCss(brand)}
${uiCss}`)}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}
