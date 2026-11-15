/** The docs page and every story pass axe (WCAG 2.2 A and AA plus best practices), with Softlander's own gate runner. */
import { serverRunner } from "@lph/checks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTokens } from "../src/build-tokens.ts";
import { PAIRS } from "../src/pairs.ts";
import { loadAdoption, loadGraph } from "../src/data.ts";
import { docsHtml } from "../src/docs.tsx";
import { STORIES } from "../src/stories.tsx";
import { analyze } from "../src/tokens.ts";
import { storyHtml } from "./browser.tsx";

type Runner = Awaited<ReturnType<typeof serverRunner>>;
let runner: Runner;
beforeAll(async () => {
  runner = await serverRunner({ offline: true });
});
afterAll(async () => {
  await runner?.close();
});

const summary = (o: { violations: { id: string; nodes: unknown[] }[] }) => o.violations.map((v) => `${v.id} (${v.nodes.length})`);

describe("accessibility", () => {
  it("the docs page has no axe violations at phone or desktop width", async () => {
    const { graph, takenAt } = loadGraph();
    const html = docsHtml({ tokens: buildTokens(graph), adoption: loadAdoption().data, report: analyze(graph, PAIRS), takenAt });
    for (const viewport of ["mobile", "desktop"] as const) {
      expect(summary(await runner.axe!(html, { path: "/docs", viewport })), viewport).toEqual([]);
    }
  });

  for (const story of STORIES) {
    it(`${story.id} has no axe violations`, async () => {
      // Stories are fragments; a landmark and heading make them whole pages so only the component is judged.
      const html = storyHtml(story).replace("<body>", `<body><main><h1>${story.title.replace(/</g, "&lt;")}</h1>`).replace("</body>", "</main></body>");
      expect(summary(await runner.axe!(html, { path: "/story", viewport: "desktop" }))).toEqual([]);
    });
  }
});
