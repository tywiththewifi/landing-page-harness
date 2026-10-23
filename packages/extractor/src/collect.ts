/**
 * Runs inside the page (via page.evaluate), so it must be self-contained:
 * no imports, no closures over module scope. It reads computed styles and
 * returns raw samples. All interpretation happens in analyze.ts.
 */

export interface ElementRef {
  selector: string;
  tag: string;
  text: string;
}

export interface TextSample extends ElementRef {
  family: string;
  size: number;
  weight: number;
  lineHeight: number;
  letterSpacing: number;
  transform: string;
  color: string;
}

export interface BoxSample extends ElementRef {
  bg: string;
  color: string;
  borderColor: string;
  borderWidth: number;
  radius: number;
  shadow: string;
  paddingX: number;
  paddingY: number;
  fontSize: number;
  fontWeight: number;
  transform: string;
  contextBg: string;
  width: number;
  height: number;
}

export interface BackgroundSample {
  color: string;
  area: number;
  count: number;
  selector: string;
  /** Short hints about where the colour appears: "header", "hero", "footer", "button", "card", "section". */
  places: string[];
}

export interface PageSample {
  url: string;
  title: string;
  siteName: string | null;
  viewport: number;
  rootVars: Record<string, string>;
  body: { bg: string; color: string; family: string };
  texts: TextSample[];
  backgrounds: BackgroundSample[];
  buttons: BoxSample[];
  links: BoxSample[];
  cards: BoxSample[];
  inputs: BoxSample[];
  spacing: number[];
  logo: { kind: "svg" | "img" | "text"; svg?: string; src?: string; text?: string; selector: string } | null;
  /** Customer or partner logos from a strip of them on the page (see findLogoStrip). */
  customerLogos: { name: string; svg?: string; src?: string; selector: string }[];
  /** @font-face rules with absolute URLs, so previews render in the real fonts. */
  fontFaces: string[];
  /** Hosted font stylesheets (Google Fonts, Adobe Fonts, ...). */
  fontStylesheets: string[];
  navLinks: { href: string; text: string }[];
  content: {
    description: string;
    lang: string;
    headings: { level: number; text: string }[];
    paragraphs: string[];
    ctas: string[];
  };
}

export async function collectPage(): Promise<PageSample> {
  const MAX_PER_TAG = 40;
  const vw = window.innerWidth;

  const px = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const isTransparent = (c: string) =>
    !c || c === "transparent" || /rgba\([^)]*,\s*0(\.0+)?\)$/.test(c) || /\/\s*0\)$/.test(c);

  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0.1;
  };

  const path = (el: Element) => {
    const parts: string[] = [];
    let cur: Element | null = el;
    for (let i = 0; cur && i < 3 && cur !== document.body; i++) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) part += `#${cur.id}`;
      else {
        const cls = [...cur.classList].filter((c) => !/^(w-|is-|js-)/.test(c)).slice(0, 2);
        if (cls.length) part += "." + cls.join(".");
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  };

  const ownText = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

  /**
   * The text a visitor sees in a control. Hover effects often stack a second copy of the
   * label outside the box (clipped until hover), and the label's colour is often set on an
   * inner span rather than the link itself, so both are read from the text that shows.
   */
  const shownText = (el: Element) => {
    const box = el.getBoundingClientRect();
    let text = "";
    let color: string | null = null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement;
      if (!parent || !n.textContent?.trim() || parent.closest("svg, script, style")) continue;
      const cs = getComputedStyle(parent);
      if (cs.visibility === "hidden" || parseFloat(cs.opacity) <= 0.1) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      // Shown means inside the control and inside every clipping box between them.
      let shown = r.width >= 1;
      for (let cur: Element | null = parent; shown && cur; cur = cur === el ? null : cur.parentElement) {
        const clip = cur === el ? box : getComputedStyle(cur).overflow !== "visible" ? cur.getBoundingClientRect() : null;
        if (clip && (x < clip.left || x > clip.right || y < clip.top || y > clip.bottom)) shown = false;
      }
      if (!shown) continue;
      text += ` ${n.textContent}`;
      color ??= cs.color;
    }
    text = text.replace(/\s+/g, " ").trim();
    // A doubled label that is laid out inside the box (no clipping to tell them apart).
    const doubled = /^(.{2,}?) ?\1$/.exec(text);
    return { text: (doubled ? doubled[1]! : text).slice(0, 80), color };
  };

  const contextBg = (el: Element) => {
    let cur: Element | null = el.parentElement;
    while (cur) {
      const bg = getComputedStyle(cur).backgroundColor;
      if (!isTransparent(bg)) return bg;
      cur = cur.parentElement;
    }
    return "rgb(255, 255, 255)";
  };

  // Build tools hash family names to scope them: next/font gives "__Inter_d65c78",
  // Astro gives "Plus Jakarta Sans-f9527f4ba30f9f35". Keep the name people know.
  const cleanFamily = (f: string) =>
    f
      .replace(/^__(.+?)_(?:Fallback_)?[0-9a-f]{5,}$/i, (_m, n: string) => n.replace(/_/g, " "))
      .replace(/^(.+?)-[0-9a-f]{8,}$/i, "$1");

  const firstFamily = (f: string) =>
    cleanFamily(f.split(",")[0]!.trim().replace(/^["']|["']$/g, "").replace(/[<>{};"'\\]/g, ""));

  const lineHeight = (cs: CSSStyleDeclaration) =>
    cs.lineHeight === "normal" ? px(cs.fontSize) * 1.2 : px(cs.lineHeight);

  const places = (el: Element): string[] => {
    const out = new Set<string>();
    const hint = (el.className && typeof el.className === "string" ? el.className : "") + " " + el.id;
    if (el.closest("header, nav, [role=banner]")) out.add("header");
    if (el.closest("footer, [role=contentinfo]")) out.add("footer");
    if (/hero/i.test(hint) || el.closest("[class*=hero], [id*=hero]")) out.add("hero");
    if (el.matches("a, button")) out.add("button");
    if (/card/i.test(hint)) out.add("card");
    if (el.matches("section, [class*=section]")) out.add("section");
    return [...out];
  };

  // --- :root custom properties and fonts ------------------------------------------
  const rootVars: Record<string, string> = {};
  const fontFaces: string[] = [];
  const fontStylesheets: string[] = [];
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      if (sheet.href && /fonts\.googleapis|typekit|fonts\.bunny|fontshare/.test(sheet.href)) fontStylesheets.push(sheet.href);
      continue; // cross-origin stylesheet
    }
    if (sheet.href && /fonts\.googleapis|typekit|fonts\.bunny|fontshare/.test(sheet.href)) fontStylesheets.push(sheet.href);
    for (const rule of [...rules]) {
      if (rule instanceof CSSFontFaceRule && fontFaces.length < 40) {
        const base = sheet.href ?? location.href;
        const family = rule.style.getPropertyValue("font-family").trim().replace(/^["']|["']$/g, "");
        // Metric-matched local() fallbacks (next/font, Astro) would shadow the real face once renamed.
        if (/fallback/i.test(family)) continue;
        const renamed = rule.cssText.replace(/font-family:\s*[^;]+;/, `font-family: "${cleanFamily(family).replace(/["\\]/g, "")}";`);
        fontFaces.push(renamed.replace(/url\((["']?)([^"')]+)\1\)/g, (_m, _q, u) => {
          try {
            return `url("${new URL(u, base).href}")`;
          } catch {
            return `url("${u}")`;
          }
        }));
        continue;
      }
      if (!(rule instanceof CSSStyleRule)) continue;
      if (!/(^|,)\s*(:root|html)\s*(,|$)/.test(rule.selectorText)) continue;
      for (const name of [...rule.style]) {
        if (name.startsWith("--") && Object.keys(rootVars).length < 300) {
          rootVars[name] = rule.style.getPropertyValue(name).trim();
        }
      }
    }
  }

  const all = [...document.body.querySelectorAll("*")].filter(
    (el) => !el.closest("script, style, noscript, svg, template, iframe"),
  );

  // --- Text --------------------------------------------------------------------
  const texts: TextSample[] = [];
  const perTag: Record<string, number> = {};
  for (const el of document.body.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, small, label, blockquote, a")) {
    const tag = el.tagName.toLowerCase();
    if ((perTag[tag] ?? 0) >= MAX_PER_TAG) continue;
    const text = ownText(el);
    if (text.length < 2 || !visible(el)) continue;
    // Links only count as body links when they sit inside running text.
    if (tag === "a" && !el.closest("p, li") ) continue;
    const cs = getComputedStyle(el);
    perTag[tag] = (perTag[tag] ?? 0) + 1;
    texts.push({
      selector: path(el),
      tag: el.matches(".eyebrow, [class*=eyebrow], [class*=overline], [class*=kicker]") ? "small" : tag,
      text,
      family: firstFamily(cs.fontFamily),
      size: px(cs.fontSize),
      weight: Number(cs.fontWeight) || 400,
      lineHeight: lineHeight(cs),
      letterSpacing: cs.letterSpacing === "normal" ? 0 : px(cs.letterSpacing),
      transform: cs.textTransform,
      color: cs.color,
    });
  }

  // --- Backgrounds (aggregated by colour) ----------------------------------------
  const bgMap = new Map<string, BackgroundSample>();
  const docArea = Math.max(document.documentElement.scrollHeight, 1) * vw;
  for (const el of [document.body, ...all]) {
    const cs = getComputedStyle(el);
    if (isTransparent(cs.backgroundColor) || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    const area = Math.min(r.width, vw) * r.height;
    const key = cs.backgroundColor;
    const entry = bgMap.get(key) ?? { color: key, area: 0, count: 0, selector: path(el), places: [] };
    entry.area += Math.min(area, docArea);
    entry.count += 1;
    for (const p of places(el)) if (!entry.places.includes(p)) entry.places.push(p);
    bgMap.set(key, entry);
  }

  // --- Boxes: buttons, links, cards, inputs ------------------------------------------
  const box = (el: Element): BoxSample => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const bw = px(cs.borderTopWidth);
    const shown = shownText(el);
    return {
      selector: path(el),
      tag: el.tagName.toLowerCase(),
      text: shown.text || ownText(el),
      bg: cs.backgroundColor,
      color: shown.color ?? cs.color,
      borderColor: bw > 0 && cs.borderTopStyle !== "none" ? cs.borderTopColor : "transparent",
      borderWidth: cs.borderTopStyle === "none" ? 0 : bw,
      radius: px(cs.borderTopLeftRadius),
      shadow: cs.boxShadow,
      paddingX: px(cs.paddingLeft),
      paddingY: px(cs.paddingTop),
      fontSize: px(cs.fontSize),
      fontWeight: Number(cs.fontWeight) || 400,
      transform: cs.textTransform,
      contextBg: contextBg(el),
      width: r.width,
      height: r.height,
    };
  };

  /**
   * The element that draws a control. Some sites style a wrapper inside the link
   * (<a><div class="button">…</div></a>), so a bare link that one child fills is read from that child.
   */
  const styledBox = (el: Element): Element => {
    let cur = el;
    for (let i = 0; i < 3; i++) {
      const cs = getComputedStyle(cur);
      const bare = isTransparent(cs.backgroundColor) && (cs.borderTopStyle === "none" || px(cs.borderTopWidth) === 0);
      const only = cur.children.length === 1 ? cur.children[0]! : null;
      if (!bare || !only) break;
      const a = cur.getBoundingClientRect();
      const r = only.getBoundingClientRect();
      if (Math.abs(a.width - r.width) > 2 || Math.abs(a.height - r.height) > 2) break;
      cur = only;
    }
    return cur;
  };

  const buttons: BoxSample[] = [];
  const links: BoxSample[] = [];
  for (const el of document.body.querySelectorAll(
    "a, button, input[type=submit], input[type=button], [role=button]",
  )) {
    if (!visible(el)) continue;
    const b = box(styledBox(el));
    if (el instanceof HTMLInputElement) b.text = el.value;
    if (b.text.length < 1 || b.text.length > 40) continue;
    const hasBg = !isTransparent(b.bg) && b.bg !== b.contextBg;
    const hasBorder = b.borderWidth >= 1 && !isTransparent(b.borderColor);
    const looksLikeButton =
      (hasBg || hasBorder) && b.paddingX >= 8 && b.height >= 24 && b.height <= 80;
    if (looksLikeButton) {
      if (buttons.length < 80) buttons.push(b);
    } else if (el.tagName === "A" && el.closest("p, li, main") && !el.closest("nav, header, footer")) {
      if (links.length < 40) links.push(b);
    }
  }

  const cards: BoxSample[] = [];
  for (const el of document.body.querySelectorAll("div, article, li, a, aside")) {
    if (cards.length >= 60 || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 160 || r.width > Math.min(820, vw * 0.9) || r.height < 80 || r.height > 900) continue;
    if (ownText(el).length < 20) continue;
    const b = box(el);
    const hasBg = !isTransparent(b.bg) && b.bg !== b.contextBg;
    const hasBorder = b.borderWidth >= 1 && !isTransparent(b.borderColor);
    const hasShadow = b.shadow && b.shadow !== "none";
    if (!(hasBg || hasBorder || hasShadow)) continue;
    if (b.radius < 2 && !hasBorder && !hasShadow) continue;
    cards.push(b);
  }

  const inputs: BoxSample[] = [];
  for (const el of document.body.querySelectorAll(
    "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), textarea, select",
  )) {
    if (inputs.length < 20 && visible(el)) inputs.push(box(el));
  }

  // --- Spacing -----------------------------------------------------------------------
  const spacing: number[] = [];
  for (const el of all) {
    if (spacing.length > 600) break;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width >= vw * 0.8 && r.height > 40) {
      spacing.push(px(cs.paddingTop), px(cs.paddingBottom), px(cs.paddingLeft));
    }
    if (cs.display.includes("flex") || cs.display.includes("grid")) {
      spacing.push(px(cs.rowGap), px(cs.columnGap));
    }
  }

  // --- Logo and navigation ---------------------------------------------------------------
  // The site header is the bar at the top of the page, whatever it's built from: <header>,
  // <nav>, a Webflow "navbar" div or a custom element. The first <header>/<nav> in the DOM
  // is often in the footer or deep in a product demo.
  const linkCount = (el: Element) => el.querySelectorAll("a[href]").length;
  const topBars = all.filter((el) => {
    const isBarLike =
      el.matches("header, [role=banner], nav, [class*=nav], [class*=header], [id*=nav], [id*=header]") ||
      ["fixed", "sticky"].includes(getComputedStyle(el).position);
    if (!isBarLike || !visible(el)) return false;
    const r = el.getBoundingClientRect();
    return r.top + window.scrollY < 160 && r.width >= vw * 0.6 && r.height <= 260 && linkCount(el) >= 2;
  });
  const header =
    topBars.sort((a, b) => linkCount(b) - linkCount(a))[0] ?? document.querySelector("header, [role=banner], nav");

  const isHomeHref = (href: string) => {
    try {
      const u = new URL(href, location.href);
      return u.origin === location.origin && /^\/((home(page)?|index(\.html?)?|[a-z]{2}(-[a-z]{2})?)\/?)?$/i.test(u.pathname);
    } catch {
      return false;
    }
  };
  /**
   * An SVG made safe to render on another page: no scripts, handlers or links out. With the
   * element still on the page (`live`), the colours the site's CSS gave each shape are baked
   * in, and shapes a <use> borrows from a sprite elsewhere on the page come along. `mono`
   * turns a one-colour drawing into currentColor, so it takes the colour of the text around it.
   */
  const cleanSvg = (svg: SVGElement, opts: { live?: SVGElement; tint?: string; mono?: boolean } = {}) => {
    const clean = svg.cloneNode(true) as SVGElement;
    const shapes = (root: Element) => [root, ...root.querySelectorAll("*")].filter((n) => n.matches("path, rect, circle, ellipse, polygon, polyline, line, text, use"));
    if (opts.live) {
      // Site CSS often colours the paths (class rules, which don't travel with the markup).
      const originals = [opts.live, ...opts.live.querySelectorAll("*")];
      [clean, ...clean.querySelectorAll("*")].forEach((node, i) => {
        const orig = originals[i];
        if (!orig || !node.matches("path, rect, circle, ellipse, polygon, polyline, line, text, use")) return;
        const cs = getComputedStyle(orig);
        if (!node.getAttribute("fill") && !/^url\(/.test(cs.fill)) node.setAttribute("fill", cs.fill);
        if (!node.getAttribute("stroke") && cs.stroke !== "none" && !/^url\(/.test(cs.stroke)) node.setAttribute("stroke", cs.stroke);
      });
      const ids = new Set(
        [...clean.querySelectorAll("use")]
          .map((u) => (u.getAttribute("href") ?? u.getAttribute("xlink:href") ?? "").trim())
          .filter((h) => h.startsWith("#") && h.length > 1)
          .map((h) => h.slice(1)),
      );
      const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      for (const id of ids) {
        if (clean.querySelector(`[id="${CSS.escape(id)}"]`)) continue;
        const target = document.getElementById(id);
        if (target?.closest("svg") && target.outerHTML.length < 20000) defs.appendChild(target.cloneNode(true));
      }
      if (defs.childNodes.length) clean.insertBefore(defs, clean.firstChild);
      if (!clean.getAttribute("viewBox") && !clean.getAttribute("width")) {
        const r = opts.live.getBoundingClientRect();
        clean.setAttribute("viewBox", `0 0 ${Math.round(r.width)} ${Math.round(r.height)}`);
      }
    }
    // A mask image: only its shape shows, in the colour behind it.
    if (opts.tint) {
      clean.setAttribute("fill", opts.tint);
      for (const n of shapes(clean)) {
        if (n.getAttribute("fill") !== "none") n.setAttribute("fill", opts.tint);
        if (n.getAttribute("stroke") && n.getAttribute("stroke") !== "none") n.setAttribute("stroke", opts.tint);
      }
    }
    clean.querySelectorAll("script, foreignObject, iframe, style").forEach((n) => n.remove());
    // Animation can set a link or a handler after the fact.
    clean.querySelectorAll("animate, set").forEach((n) => {
      const target = (n.getAttribute("attributeName") ?? "").toLowerCase();
      if (target.startsWith("on") || target.endsWith("href")) n.remove();
    });
    for (const node of [clean, ...clean.querySelectorAll("*")]) {
      for (const attr of [...node.attributes]) {
        const v = attr.value.trim().toLowerCase();
        if (attr.name.startsWith("on") || ((attr.name === "href" || attr.name === "xlink:href") && !v.startsWith("#"))) {
          node.removeAttribute(attr.name);
        }
      }
    }
    if (!clean.getAttribute("viewBox") && clean.getAttribute("width") && clean.getAttribute("height")) {
      clean.setAttribute("viewBox", `0 0 ${parseFloat(clean.getAttribute("width")!)} ${parseFloat(clean.getAttribute("height")!)}`);
    }
    if (opts.mono) {
      const paints = new Set(shapes(clean).flatMap((n) => ["fill", "stroke"].map((a) => n.getAttribute(a)).filter((c): c is string => !!c && c !== "none" && !isTransparent(c))));
      if (paints.size === 1) {
        for (const n of shapes(clean)) for (const a of ["fill", "stroke"]) if (n.getAttribute(a) && n.getAttribute(a) !== "none") n.setAttribute(a, "currentColor");
        clean.removeAttribute("color");
      }
    }
    if (!clean.getAttribute("fill") && !clean.querySelector("[fill]")) clean.setAttribute("fill", "currentColor");
    return clean;
  };
  const parseSvg = (text: string): SVGElement | null => {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const root = doc.documentElement;
    return root.tagName.toLowerCase() === "svg" && !doc.querySelector("parsererror") ? (document.importNode(root, true) as unknown as SVGElement) : null;
  };
  /** An SVG from a data: URL, or fetched (through the importer's network guard). Null for other images. */
  const svgAt = async (url: string): Promise<SVGElement | null> => {
    try {
      const data = /^data:image\/svg\+xml([^,]*),(.*)$/s.exec(url);
      if (data) return parseSvg(data[1]!.includes("base64") ? atob(data[2]!) : decodeURIComponent(data[2]!));
      if (!/\.svg([?#]|$)/i.test(new URL(url).pathname + new URL(url).search)) return null;
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 4000);
      const res = await fetch(url, { signal: abort.signal }).finally(() => clearTimeout(timer));
      const text = res.ok ? await res.text() : "";
      return text.length && text.length < 60000 ? parseSvg(text) : null;
    } catch {
      return null;
    }
  };
  /** A logo drawn with CSS (Framer and others): a background or mask image inside the link. */
  const cssGraphic = (scope: Element) => {
    for (const el of [scope, ...scope.querySelectorAll("*")]) {
      const r = el.getBoundingClientRect();
      if (r.width < 12 || r.height < 8) continue;
      const cs = getComputedStyle(el);
      const mask = [cs.getPropertyValue("mask-image"), cs.getPropertyValue("-webkit-mask-image")].find((v) => /url\(/.test(v));
      const image = mask ?? (/url\(/.test(cs.backgroundImage) ? cs.backgroundImage : null);
      const url = image && /url\(\s*(["']?)(.*?)\1\s*\)/.exec(image)?.[2];
      if (url) return { el, url, tint: mask ? cs.backgroundColor : null };
    }
    return null;
  };

  let logo: PageSample["logo"] = null;
  let logoLink: HTMLAnchorElement | null = null;
  if (header) {
    const anchors = [...header.querySelectorAll("a")].filter((a) => visible(a));
    const graphic = (a: Element) => a.querySelector("svg, img") ?? cssGraphic(a);
    const left = (a: Element) => a.getBoundingClientRect().left;
    // Prefer a home link with a graphic, then the left-most link with a graphic, then any
    // home link with text (not a link to a section of the home page).
    logoLink =
      anchors.find((a) => isHomeHref(a.href) && graphic(a)) ??
      anchors.filter((a) => graphic(a) && left(a) < vw * 0.3).sort((a, b) => left(a) - left(b))[0] ??
      anchors.find((a) => isHomeHref(a.href) && !new URL(a.href, location.href).hash && ownText(a).length > 0) ??
      null;
    const scope = logoLink ?? header;
    // Sites often ship a second logo for small screens, hidden on desktop.
    const svg = [...scope.querySelectorAll("svg")].find(visible) ?? scope.querySelector("svg");
    const img = [...scope.querySelectorAll("img")].find(visible) ?? scope.querySelector("img");
    const drawn = !svg && !img ? cssGraphic(scope) : null;
    // Only text shown next to the mark (a wordmark), not the SVG's own <title>/<text>.
    const label = () => {
      let text = "";
      if (!logoLink) return undefined;
      const walker = document.createTreeWalker(logoLink, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const parent = n.parentElement;
        if (parent && !parent.closest("svg") && visible(parent)) text += ` ${n.textContent ?? ""}`;
      }
      return text.replace(/\s+/g, " ").trim() || undefined;
    };
    if (svg && svg.outerHTML.length < 30000) {
      const clean = cleanSvg(svg, { live: svg });
      // currentColor came from the site's CSS (often a brand colour); keep it once the logo leaves the page.
      if (!clean.getAttribute("color")) clean.setAttribute("color", getComputedStyle(svg).color);
      logo = { kind: "svg", svg: clean.outerHTML, text: label(), selector: path(svg) };
    } else if (img) {
      logo = { kind: "img", src: (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src, selector: path(img) };
    } else if (drawn) {
      const found = await svgAt(drawn.url);
      const r = drawn.el.getBoundingClientRect();
      if (found) {
        if (!found.getAttribute("viewBox") && !found.getAttribute("width")) found.setAttribute("viewBox", `0 0 ${Math.round(r.width)} ${Math.round(r.height)}`);
        logo = { kind: "svg", svg: cleanSvg(found, { tint: drawn.tint ?? undefined }).outerHTML, text: label(), selector: path(drawn.el) };
      } else if (!drawn.url.startsWith("data:")) {
        logo = { kind: "img", src: drawn.url, selector: path(drawn.el) };
      }
    }
    if (!logo && logoLink && ownText(logoLink)) {
      logo = { kind: "text", text: ownText(logoLink), selector: path(logoLink) };
    }
  }

  // The logo usually links home (sometimes to /homepage), so it is never the product page.
  const navLinks = header
    ? [...header.querySelectorAll("a")]
        .filter((a) => a !== logoLink && !isHomeHref(a.href))
        .map((a) => ({ href: a.href, text: ownText(a) }))
        .filter((l) => l.href.startsWith("http"))
        .slice(0, 40)
    : [];

  // --- Customer logos --------------------------------------------------------------
  // A strip of them: a row of at least four cells that each hold one wide image or SVG and
  // little text, outside the header and footer. Icons, avatars, stars and thumbnails are
  // about as tall as they are wide, so they're left out. Each logo needs a name from the
  // markup (alt text, a label, a title, hidden text, the file name, or a /customers/<name>
  // link), because the page shows it and its alt text says it.
  const customerLogos: PageSample["customerLogos"] = [];
  {
    const graphics = [...document.body.querySelectorAll("img, svg")].filter((el) => {
      if (el.tagName.toLowerCase() === "svg" && el.parentElement?.closest("svg")) return false;
      if (el.closest("header, nav, footer, button, form, [role=banner], [role=navigation], [role=contentinfo], [role=dialog]")) return false;
      const r = el.getBoundingClientRect();
      if (r.height < 10 || r.height > 140 || r.width < 16 || r.width > 420) return false;
      // Marquee copies scroll out of view, so only the box and display matter here.
      const cs = getComputedStyle(el);
      return cs.display !== "none" && cs.visibility !== "hidden";
    });
    const isGraphic = new Set(graphics);
    const count = (el: Element) => graphics.reduce((n, g) => n + (el.contains(g) ? 1 : 0), 0);
    // Text a visitor reads in a cell: hidden labels (1px, clipped) don't count.
    const shown = (cell: Element) => {
      let text = "";
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const r = n.parentElement?.getBoundingClientRect();
        if (r && r.width > 2 && r.height > 2 && !n.parentElement!.closest("svg")) text += n.textContent ?? "";
      }
      return text.replace(/\s+/g, " ").trim();
    };
    const tidy = (name: string, file: boolean) => {
      let n = name.replace(/\b(company |customer |client |partner )?(logo(type)?|wordmark|logomark)( of| for)?\b/gi, " ");
      // File names add variants: verifone-dark.svg, acme_logo_white.png.
      if (file) n = n.replace(/[-_]+/g, " ").replace(/\b(dark|light|white|black|grey|gray|colou?r|mono|full|small|large|web|icon|\d+x?)\b/gi, " ");
      n = n.replace(/\s+/g, " ").trim();
      return n === n.toLowerCase() && !/\./.test(n) ? n.replace(/\b\w/g, (c) => c.toUpperCase()) : n;
    };
    const nameOf = (g: Element, cell: Element) => {
      const attr = (el: Element | null | undefined, ...names: string[]) => names.map((n) => el?.getAttribute(n)?.trim()).find(Boolean) ?? "";
      const link = g.closest("a") ?? cell.querySelector("a");
      const labelled = attr(g, "aria-labelledby") && document.getElementById(attr(g, "aria-labelledby"))?.textContent;
      const hidden = (cell.textContent ?? "").replace(/\s+/g, " ").trim();
      const slug = link && /\/(customers?|case-stud(y|ies)|stories|clients?)\/([\w-]{2,40})\/?$/i.exec(new URL(link.href, location.href).pathname)?.[3];
      const file = g.tagName.toLowerCase() === "img" ? ((g as HTMLImageElement).currentSrc || (g as HTMLImageElement).src).split(/[?#]/)[0]!.split("/").pop()!.replace(/\.\w+$/, "") : "";
      const raw =
        (g.tagName.toLowerCase() === "img" ? attr(g, "alt") : "") ||
        attr(g, "aria-label", "title") ||
        labelled ||
        (g.querySelector("title")?.textContent ?? "").trim() ||
        attr(link, "aria-label", "title") ||
        (hidden.length <= 40 ? hidden : "");
      // Alt text that is really a file name: "WEB_Black_Malt".
      if (raw) return tidy(raw, !/\s/.test(raw) && /[-_]/.test(raw)).slice(0, 60);
      if (slug) return tidy(slug, true).slice(0, 60);
      const usable = /^[a-z][\w-]{1,40}$/i.test(file) && !/^(image|img|logo|frame|group|asset|untitled)[\w-]*$/i.test(file) && !/[0-9a-f]{8}/i.test(file);
      return usable ? tidy(file, true).slice(0, 60) : "";
    };
    const strips: { row: Element; logos: PageSample["customerLogos"]; score: number }[] = [];
    const seen = new Set<Element>();
    for (const g of graphics) {
      let cell: Element = g;
      while (cell.parentElement && cell.parentElement !== document.body && count(cell.parentElement) < 4) cell = cell.parentElement;
      const row = cell.parentElement;
      if (!row || row === document.body || seen.has(row)) continue;
      seen.add(row);
      const kids = [...row.children].filter((k) => k.getBoundingClientRect().width > 0);
      const cells = kids.filter((k) => count(k) === 1 && shown(k).length <= 24);
      if (cells.length < 4 || cells.length < kids.length * 0.6) continue;
      const items = cells.map((c) => {
        const mark = isGraphic.has(c) ? c : [...c.querySelectorAll("img, svg")].find((x) => isGraphic.has(x))!;
        const r = mark.getBoundingClientRect();
        return { cell: c, mark, ratio: r.width / r.height };
      });
      const ratios = items.map((i) => i.ratio).sort((a, b) => a - b);
      if (ratios[ratios.length >> 1]! < 1.6) continue;
      const logos: PageSample["customerLogos"] = [];
      for (const { cell: c, mark } of items) {
        const name = nameOf(mark, c);
        if (!name || logos.some((l) => l.name.toLowerCase() === name.toLowerCase())) continue;
        if (mark.tagName.toLowerCase() === "svg") {
          const svg = cleanSvg(mark as SVGElement, { live: mark as SVGElement, mono: true }).outerHTML;
          if (svg.length < 15000) logos.push({ name, svg, selector: path(mark) });
        } else {
          const src = (mark as HTMLImageElement).currentSrc || (mark as HTMLImageElement).src;
          if (/^https?:/.test(src)) logos.push({ name, src, selector: path(mark) });
        }
      }
      if (logos.length < 3) continue;
      const top = row.getBoundingClientRect().top + window.scrollY;
      strips.push({ row, logos, score: logos.length + (top < 2500 ? 4 : 0) });
    }
    const best = strips.sort((a, b) => b.score - a.score)[0];
    if (best) customerLogos.push(...best.logos.slice(0, 16));
  }

  // --- Copy (for grounding briefs, not for styling) ------------------------------
  const fullText = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const headings: { level: number; text: string }[] = [];
  for (const el of document.body.querySelectorAll("h1, h2, h3, h4")) {
    const text = fullText(el);
    if (text.length > 1 && text.length < 200 && visible(el) && !el.closest("footer")) {
      headings.push({ level: Number(el.tagName[1]), text });
    }
  }
  const paragraphs: string[] = [];
  for (const el of document.body.querySelectorAll("p, li, blockquote")) {
    if (el.closest("nav, footer, header") || el.querySelector("p, li")) continue;
    const text = fullText(el);
    if (text.length >= 40 && text.length <= 500 && visible(el) && !paragraphs.includes(text)) paragraphs.push(text);
  }
  const ctaCount = new Map<string, number>();
  for (const b of buttons) if (b.text && b.text.length <= 40) ctaCount.set(b.text, (ctaCount.get(b.text) ?? 0) + 1);
  const content = {
    description:
      document.querySelector("meta[name='description']")?.getAttribute("content") ??
      document.querySelector("meta[property='og:description']")?.getAttribute("content") ??
      "",
    lang: document.documentElement.lang || "en",
    headings: headings.slice(0, 40),
    paragraphs: paragraphs.slice(0, 30),
    ctas: [...ctaCount.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 12),
  };

  const bodyCs = getComputedStyle(document.body);
  const htmlBg = getComputedStyle(document.documentElement).backgroundColor;

  return {
    url: location.href,
    title: document.title,
    siteName: document.querySelector("meta[property='og:site_name']")?.getAttribute("content") ?? null,
    viewport: vw,
    rootVars,
    body: {
      bg: isTransparent(bodyCs.backgroundColor) ? (isTransparent(htmlBg) ? "rgb(255, 255, 255)" : htmlBg) : bodyCs.backgroundColor,
      color: bodyCs.color,
      family: firstFamily(bodyCs.fontFamily),
    },
    texts,
    backgrounds: [...bgMap.values()],
    buttons,
    links,
    cards,
    inputs,
    spacing: spacing.filter((n) => n > 0 && n < 400),
    logo,
    customerLogos,
    navLinks,
    fontFaces,
    fontStylesheets,
    content,
  };
}

/**
 * Runs inside the page before collectPage. Removes cookie and consent banners (and their
 * backdrops) so their buttons and colours aren't mistaken for the brand's. Nothing is
 * accepted on the visitor's behalf: the elements are just taken out of the DOM.
 * Returns how many elements were removed.
 */
export function removeOverlays(): number {
  const CONSENT = /cookie|consent|gdpr|ccpa|privacy (settings|preferences|choices)/i;
  const KNOWN = [
    "#onetrust-consent-sdk",
    "#CybotCookiebotDialog",
    "#usercentrics-root",
    "#usercentrics-cmp-ui",
    "#didomi-host",
    "#truste-consent-track",
    "#hs-eu-cookie-confirmation",
    "#cmplz-cookiebanner-container",
    "#cookiescript_injected",
    "#qc-cmp2-container",
    "[id^=sp_message_container]",
    ".cky-consent-container",
    ".cky-overlay",
    ".cc-window",
    ".osano-cm-window",
    "[class*=fs-cc-banner]",
    "[class*=fs-cc-prefs]",
    "[fs-cc=banner]",
    "[fs-cc=preferences]",
  ].join(", ");
  let removed = 0;
  const drop = (el: Element) => {
    if (!el.isConnected) return;
    el.remove();
    removed++;
  };
  document.querySelectorAll(KNOWN).forEach(drop);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  for (const el of [...document.body.querySelectorAll("*")]) {
    if (!el.isConnected) continue;
    const cs = getComputedStyle(el);
    const overlay = cs.position === "fixed" || cs.position === "sticky" || el.matches("dialog[open], [role=dialog], [aria-modal=true]");
    if (!overlay) continue;
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length > 0 && text.length < 2000 && CONSENT.test(text) && el.querySelectorAll("a[href]").length < 15) {
      drop(el);
      continue;
    }
    // An empty fixed layer over most of the screen is a modal backdrop.
    const r = el.getBoundingClientRect();
    if (cs.position === "fixed" && !text && !el.querySelector("img, svg, video, canvas") && r.width >= vw * 0.9 && r.height >= vh * 0.9) {
      drop(el);
    }
  }
  // Banners often lock scrolling; lazy sections only load if we can scroll.
  for (const el of [document.documentElement, document.body]) {
    if (getComputedStyle(el).overflowY === "hidden") el.style.setProperty("overflow", "visible", "important");
  }
  return removed;
}
