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
  content: {
    description: string;
    lang: string;
    headings: { level: number; text: string }[];
    paragraphs: string[];
    ctas: string[];
  };
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
  let logo: PageSample["logo"] = null;
  let logoLink: HTMLAnchorElement | null = null;
  if (header) {
    const anchors = [...header.querySelectorAll("a")].filter((a) => visible(a));
    const graphic = (a: Element) => a.querySelector("svg, img");
    const left = (a: Element) => a.getBoundingClientRect().left;
    // Prefer a home link with a graphic, then the left-most link with a graphic, then any home link.
    logoLink =
      anchors.find((a) => isHomeHref(a.href) && graphic(a)) ??
      anchors.filter((a) => graphic(a) && left(a) < vw * 0.3).sort((a, b) => left(a) - left(b))[0] ??
      anchors.find((a) => isHomeHref(a.href) && ownText(a).length > 0) ??
      null;
    const scope = logoLink ?? header;
    const svg = scope.querySelector("svg");
    const img = scope.querySelector("img");
    if (svg && svg.outerHTML.length < 30000) {
      // Sanitise with the DOM while we have one: the markup is later rendered inline.
      const clean = svg.cloneNode(true) as SVGElement;
      // Site CSS often colours the paths (class rules, which don't travel with the markup),
      // so bake the rendered fill and stroke into each shape.
      const originals = [svg, ...svg.querySelectorAll("*")];
      [clean, ...clean.querySelectorAll("*")].forEach((node, i) => {
        const orig = originals[i];
        if (!orig || !node.matches("path, rect, circle, ellipse, polygon, polyline, line, text, use")) return;
        const cs = getComputedStyle(orig);
        if (!node.getAttribute("fill") && !/^url\(/.test(cs.fill)) node.setAttribute("fill", cs.fill);
        if (!node.getAttribute("stroke") && cs.stroke !== "none" && !/^url\(/.test(cs.stroke)) node.setAttribute("stroke", cs.stroke);
      });
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
      // currentColor came from the site's CSS (often a brand colour); keep it once the logo leaves the page.
      if (!clean.getAttribute("color")) clean.setAttribute("color", getComputedStyle(svg).color);
      // Only text shown next to the mark (a wordmark), not the SVG's own <title>/<text>.
      let label = "";
      if (logoLink) {
        const walker = document.createTreeWalker(logoLink, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const parent = n.parentElement;
          if (parent && !parent.closest("svg") && visible(parent)) label += ` ${n.textContent ?? ""}`;
        }
        label = label.replace(/\s+/g, " ");
      }
      logo = { kind: "svg", svg: clean.outerHTML, text: label.trim() || undefined, selector: path(svg) };
    } else if (img) {
      logo = { kind: "img", src: (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src, selector: path(img) };
    } else if (logoLink && ownText(logoLink)) {
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
