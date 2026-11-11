/** Shared set-up for the tests that render components in Chromium. */
import { chromium, type Browser, type Page } from "playwright";
import { pageHtml } from "../src/render.tsx";
import { STORY_CSS, type Story } from "../src/stories.tsx";

export const launch = (): Promise<Browser> => chromium.launch({ headless: true, executablePath: process.env.LPH_CHROMIUM_PATH || undefined });

export function storyHtml(story: Story): string {
  return pageHtml(
    <div id="story" className={`story sl-mode-${story.mode}`}>
      {story.render()}
    </div>,
    { title: story.title, extraCss: STORY_CSS },
  );
}

/** A page at the width the live components were measured at, with the story loaded and fonts ready. */
export async function openStory(browser: Browser, story: Story, opts: { reducedMotion?: boolean } = {}): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 400 }, deviceScaleFactor: 1, reducedMotion: opts.reducedMotion ? "reduce" : "no-preference" });
  const page = await context.newPage();
  await page.setContent(storyHtml(story), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return page;
}
