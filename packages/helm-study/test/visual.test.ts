/**
 * Visual regression: every story, at rest and (for the arrowed ones) on hover, is
 * screenshotted and compared pixel by pixel with the committed baseline. Inter is
 * inlined so text renders the same on any machine. A missing baseline is written and
 * the test passes; UPDATE_SCREENSHOTS=1 rewrites them all after an intended change.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STORIES } from "../src/stories.tsx";
import { launch, openStory } from "./browser.tsx";

const DIR = join(import.meta.dirname, "__screenshots__");
const UPDATE = process.env.UPDATE_SCREENSHOTS === "1";
/** A pixel counts as changed when a channel moves by more than this (0-255)... */
const CHANNEL = 40;
/** ...and the shot fails when more than this share of pixels changed. Anti-aliasing differs a little between Chromium builds. */
const SHARE = 0.01;

let browser: Browser;
let differ: Page;
beforeAll(async () => {
  browser = await launch();
  differ = await (await browser.newContext()).newPage();
});
afterAll(async () => {
  await browser?.close();
});

/** Compares two PNGs in the browser with canvas, so no image library is needed. */
async function diff(a: Buffer, b: Buffer): Promise<{ sameSize: boolean; changed: number; total: number }> {
  return differ.evaluate(
    async ([a64, b64, channel]) => {
      const load = (b: string) =>
        new Promise<HTMLImageElement>((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = "data:image/png;base64," + b;
        });
      const [x, y] = await Promise.all([load(a64), load(b64)]);
      if (x.width !== y.width || x.height !== y.height) return { sameSize: false, changed: 0, total: 0 };
      const pixels = (img: HTMLImageElement) => {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height).data;
      };
      const p = pixels(x);
      const q = pixels(y);
      let changed = 0;
      for (let i = 0; i < p.length; i += 4) {
        if (Math.abs(p[i]! - q[i]!) > channel || Math.abs(p[i + 1]! - q[i + 1]!) > channel || Math.abs(p[i + 2]! - q[i + 2]!) > channel || Math.abs(p[i + 3]! - q[i + 3]!) > channel) changed++;
      }
      return { sameSize: true, changed, total: p.length / 4 };
    },
    [a.toString("base64"), b.toString("base64"), CHANNEL] as const,
  );
}

async function check(name: string, shot: Buffer) {
  const file = join(DIR, `${name}.png`);
  if (UPDATE || !existsSync(file)) {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(file, shot);
    return;
  }
  const result = await diff(readFileSync(file), shot);
  if (!result.sameSize) writeFileSync(join(DIR, `${name}.actual.png`), shot);
  expect(result.sameSize, `${name} changed size`).toBe(true);
  const share = result.changed / result.total;
  if (share > SHARE) writeFileSync(join(DIR, `${name}.actual.png`), shot);
  expect(share, `${name}: ${(share * 100).toFixed(2)}% of pixels changed; see ${name}.actual.png`).toBeLessThanOrEqual(SHARE);
}

describe("visual regression", () => {
  for (const story of STORIES) {
    it(story.id, async () => {
      const page = await openStory(browser, story, { reducedMotion: true });
      try {
        const el = page.locator("#story");
        await check(story.id, await el.screenshot({ animations: "disabled" }));
        if (await page.locator("#story .sl-hover-arrow").count()) {
          await page.locator("#story > *").first().hover();
          await check(`${story.id}--hover`, await el.screenshot({ animations: "disabled" }));
        }
      } finally {
        await page.context().close();
      }
    });
  }

  it("shows a focus ring for keyboard users", async () => {
    const page = await openStory(browser, STORIES.find((s) => s.id === "button-native")!, { reducedMotion: true });
    try {
      await page.keyboard.press("Tab");
      const outline = await page.$eval("#story button", (el) => getComputedStyle(el).outlineStyle + " " + getComputedStyle(el).outlineWidth);
      expect(outline).toBe("solid 2px");
      await check("button-native--focus", await page.locator("#story").screenshot({ animations: "disabled" }));
    } finally {
      await page.context().close();
    }
  });
});
