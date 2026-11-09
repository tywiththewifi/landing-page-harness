/**
 * Design–code parity: each story with a `parity` entry is rendered in Chromium and
 * measured with the same function that measured live stripe.com, then compared
 * property by property, at rest and on hover.
 */
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadLive } from "../src/data.ts";
import { measure, type Measurement, type StyleProp } from "../src/measure.ts";
import { STORIES } from "../src/stories.tsx";
import { launch, openStory } from "./browser.tsx";

const live = loadLive().data;
let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser?.close();
});

/** Lengths within half a pixel count as equal; everything else must match exactly. */
function same(a: string | undefined, b: string | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const px = (s: string) => (/^-?[\d.]+px$/.test(s) ? parseFloat(s) : NaN);
  return Math.abs(px(a) - px(b)) <= 0.5;
}

async function measureStory(id: string): Promise<Measurement> {
  const story = STORIES.find((s) => s.id === id)!;
  const page = await openStory(browser, story);
  try {
    const [m] = await measure(page, id, [{ label: id, selector: "#story > *" }]);
    if (!m) throw new Error(`${id} rendered nothing`);
    return m;
  } finally {
    await page.context().close();
  }
}

const checked = STORIES.filter((s) => s.parity);

describe("parity with live Helm", () => {
  it("has a live measurement for every story that claims one", () => {
    for (const s of checked) expect(live.find((m) => m.label === s.parity!.live), s.parity!.live).toBeDefined();
  });

  for (const story of checked) {
    it(`${story.id} matches ${story.parity!.live}`, async () => {
      const target = live.find((m) => m.label === story.parity!.live)!;
      const mine = await measureStory(story.id);
      const mismatches: string[] = [];
      for (const p of story.parity!.props) {
        if (!same(mine.rest[p], target.rest[p])) mismatches.push(`${p}: ${mine.rest[p]} (live ${target.rest[p]})`);
        const liveHover = target.hover[p as StyleProp];
        if (liveHover !== undefined && !same(mine.hover[p] ?? mine.rest[p], liveHover)) mismatches.push(`${p} on hover: ${mine.hover[p] ?? mine.rest[p]} (live ${liveHover})`);
      }
      if (target.arrowTravel !== undefined && mine.arrowTravel !== target.arrowTravel) mismatches.push(`arrow travel: ${mine.arrowTravel} (live ${target.arrowTravel})`);
      expect(mismatches).toEqual([]);
    });
  }

  it("drops the motion, not the arrow, for people who ask for reduced motion", async () => {
    const page = await openStory(browser, STORIES.find((s) => s.id === "button-primary")!, { reducedMotion: true });
    try {
      const duration = await page.$eval(".sl-hover-arrow__group", (el) => getComputedStyle(el).transitionDuration);
      expect(duration).toBe("0s");
    } finally {
      await page.context().close();
    }
  });
});
