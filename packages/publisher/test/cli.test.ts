import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { parseDocument, runGate } from "@lph/checks";
import { renderVersions, type Page } from "@lph/page";
import { brand, finishedPage, uiCss } from "../../checks/test/fixture.ts";
import { siteFiles, type SiteConfig } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "../src/cli.ts");
const template = join(here, "../../../templates/site");
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const css = await uiCss();
const config: SiteConfig = { ...JSON.parse(readFileSync(join(template, "lph.json"), "utf8")), formEndpoint: "site" };

/** A site repo made from the template, with the page published on main. */
async function siteRepo(page: Page, brief: Awaited<ReturnType<typeof finishedPage>>["brief"]) {
  const dir = mkdtempSync(join(tmpdir(), "lph-site-"));
  dirs.push(dir);
  cpSync(template, dir, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { encoding: "utf8" });
  const write = async (p: Page) => {
    const versions = renderVersions(p, brand, css, { origin: config.origin, formAction: `/api/forms/${p.id}` });
    const gate = await runGate({ model: { page: p, brief, brand }, versions }, { environment: "browser", parse: parseDocument });
    for (const f of await siteFiles({ page: p, brand, uiCss: css, config, gate, targets: { keyword: brief.seo.primaryKeyword, questions: brief.seo.questions.map((q) => q.question) }, read: async (path) => { try { return readFileSync(join(dir, path), "utf8"); } catch { return null; } } })) {
      mkdirSync(dirname(join(dir, f.path)), { recursive: true });
      writeFileSync(join(dir, f.path), f.content);
    }
  };
  git("init", "-q", "-b", "main");
  await write(page);
  git("add", "-A");
  git("commit", "-q", "-m", "Publish");
  return { dir, git, write };
}

const run = (dir: string, command: string, ...extra: string[]) => {
  const out = join(dir, "..", `${dir.split("/").pop()}-output`);
  writeFileSync(out, "");
  const res = spawnSync("npx", ["tsx", cli, command, "--repo", dir, "--base", "main", ...extra], { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: out }, cwd: join(here, "..") });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, output: Object.fromEntries(readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map((l) => l.split("=") as [string, string])) };
};

describe("lph-site (the site repo's CI)", () => {
  it("lets a copy edit merge itself, and sends anything else to a reviewer", async () => {
    const { page, brief } = await finishedPage();
    page.blocks = page.blocks.filter((b) => b.type !== "testimonial");
    const repo = await siteRepo(page, brief);

    repo.git("checkout", "-q", "-b", "lph/copy");
    const copy = structuredClone(page);
    if (copy.blocks[0]!.type === "hero") copy.blocks[0]!.lead = "A sharper subheadline.";
    await repo.write(copy);
    repo.git("commit", "-q", "-am", "Copy");
    const ok = run(repo.dir, "check", "--offline");
    expect(ok.stderr).toBe("");
    expect(ok.output).toEqual({ risk: "content", verdict: "ready" });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("Copy only");

    // A hand edit to a file outside the pages, on the same branch, needs a reviewer.
    writeFileSync(join(repo.dir, "site/index.html"), "<p>changed</p>");
    repo.git("commit", "-q", "-am", "Sneak");
    const sneaky = run(repo.dir, "classify");
    expect(sneaky.output).toEqual({ risk: "review" });
    expect(sneaky.stdout).toContain("Files outside the landing pages change: site/index.html");

    repo.git("checkout", "-q", "main");
    repo.git("checkout", "-q", "-b", "lph/sections");
    const sections = structuredClone(page);
    sections.blocks.splice(2, 1);
    await repo.write(sections);
    repo.git("commit", "-q", "-am", "Sections");
    const review = run(repo.dir, "classify");
    expect(review.output).toEqual({ risk: "review" });
    expect(review.stdout).toContain("Sections were added, removed or reordered.");
  });

  it("blocks a page whose HTML fails the checks", async () => {
    const { page, brief } = await finishedPage();
    page.blocks = page.blocks.filter((b) => b.type !== "testimonial");
    const repo = await siteRepo(page, brief);
    repo.git("checkout", "-q", "-b", "lph/broken");
    const copy = structuredClone(page);
    copy.seo.title = "A new title for the HubSpot integration page";
    await repo.write(copy);
    // Someone edits the generated HTML by hand and drops the H1.
    const file = join(repo.dir, "site/hubspot-integration.html");
    writeFileSync(file, readFileSync(file, "utf8").replace(/<h1([^>]*)>/, "<h2$1>").replace("</h1>", "</h2>"));
    repo.git("commit", "-q", "-am", "Broken");
    const res = run(repo.dir, "check", "--offline");
    expect(res.status).toBe(1);
    expect(res.output.verdict).toBe("blocked");
    expect(res.stdout).toContain("The page has no H1.");
  });
});
