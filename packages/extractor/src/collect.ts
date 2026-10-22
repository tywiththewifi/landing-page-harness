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
  /** @font-face rules with absolute URLs, so previews render in the real fonts. */
  fontFaces: string[];
  /** Hosted font stylesheets (Google Fonts, Adobe Fonts, ...). */
  fontStylesheets: string[];
  navLinks: { href: string; text: string }[];
}

export function collectPage(): PageSample {
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

  const contextBg = (el: Element) => {
    let cur: Element | null = el.parentElement;
    while (cur) {
      const bg = getComputedStyle(cur).backgroundColor;
      if (!isTransparent(bg)) return bg;
      cur = cur.parentElement;
    }
    return "rgb(255, 255, 255)";
  };

  const firstFamily = (f: string) => f.split(",")[0]!.trim().replace(/^["']|["']$/g, "");

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
        fontFaces.push(rule.cssText.replace(/url\((["']?)([^"')]+)\1\)/g, (_m, _q, u) => {
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
    return {
      selector: path(el),
      tag: el.tagName.toLowerCase(),
      text: ownText(el),
      bg: cs.backgroundColor,
      color: cs.color,
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

  const buttons: BoxSample[] = [];
  const links: BoxSample[] = [];
  for (const el of document.body.querySelectorAll(
    "a, button, input[type=submit], input[type=button], [role=button]",
  )) {
    if (!visible(el)) continue;
    const b = box(el);
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
  const header = document.querySelector("header, [role=banner], nav");
  let logo: PageSample["logo"] = null;
  if (header) {
    const home = [...header.querySelectorAll("a")].find((a) => {
      try {
        const u = new URL(a.href, location.href);
        return u.origin === location.origin && (u.pathname === "/" || u.pathname === "");
      } catch {
        return false;
      }
    });
    const scope = home ?? header;
    const svg = scope.querySelector("svg");
    const img = scope.querySelector("img");
    if (svg && svg.outerHTML.length < 30000) {
      // Sanitise with the DOM while we have one: the markup is later rendered inline.
      const clean = svg.cloneNode(true) as SVGElement;
      clean.querySelectorAll("script, foreignObject, iframe, style").forEach((n) => n.remove());
      for (const node of [clean, ...clean.querySelectorAll("*")]) {
        for (const attr of [...node.attributes]) {
          const v = attr.value.trim().toLowerCase();
          if (attr.name.startsWith("on") || ((attr.name === "href" || attr.name === "xlink:href") && !v.startsWith("#"))) {
            node.removeAttribute(attr.name);
          }
        }
      }
      if (!clean.getAttribute("fill") && !clean.querySelector("[fill]")) clean.setAttribute("fill", "currentColor");
      logo = { kind: "svg", svg: clean.outerHTML, text: ownText(scope) || undefined, selector: path(svg) };
    } else if (img) {
      logo = { kind: "img", src: (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src, selector: path(img) };
    } else if (home && ownText(home)) {
      logo = { kind: "text", text: ownText(home), selector: path(home) };
    }
  }

  const navLinks = header
    ? [...header.querySelectorAll("a")]
        .map((a) => ({ href: a.href, text: ownText(a) }))
        .filter((l) => l.href.startsWith("http"))
        .slice(0, 40)
    : [];

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
    navLinks,
    fontFaces,
    fontStylesheets,
  };
}
