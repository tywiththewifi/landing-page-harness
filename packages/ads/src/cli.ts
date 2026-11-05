#!/usr/bin/env -S npx tsx
/**
 * Brand kit, brief and landing page in; checked, voiced audio ads out.
 *
 *   pnpm ads                                  # the Hostinger demo, into runs/ads-hostinger
 *   pnpm ads --concepts runs/ads-hostinger/concepts.json   # re-check saved scripts, no model
 *   pnpm ads --inputs path/to/folder --out runs/ads-mine   # brand.json, brief.json, page.json
 *
 * Needs ANTHROPIC_API_KEY to write scripts (unless --concepts) and ELEVENLABS_API_KEY to
 * voice any script that isn't already in the clip cache.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { renderVersions } from "@lph/page";
import { evalsMarkdown, runEvals } from "../evals/index.ts";
import { AD_BRIEF } from "../evals/cases.ts";
import { HOSTINGER, loadInputs } from "./demo.ts";
import { ElevenLabs, cachedVoicer } from "./elevenlabs.ts";
import { renderReport } from "./report.ts";
import { runAds } from "./run.ts";
import { adBrief, savedConcepts } from "./schema.ts";
import { claudeWriter, fixedWriter, type ConceptWriter } from "./writer.ts";

const { values } = parseArgs({
  options: {
    inputs: { type: "string" },
    out: { type: "string", default: "runs/ads-hostinger" },
    concepts: { type: "string" },
    "voice-id": { type: "string", default: "nPczCjzI2devNBz1zQrb" },
    "voice-name": { type: "string", default: "Brian" },
    "tts-model": { type: "string", default: "eleven_multilingual_v2" },
    "stt-model": { type: "string", default: "scribe_v2" },
    model: { type: "string" },
    clips: { type: "string" },
    "no-revise": { type: "boolean", default: false },
  },
});

// pnpm runs this from the package folder; paths on the command line are relative to where it was typed.
const cwd = process.env.INIT_CWD ?? process.cwd();
const inputsDir = values.inputs ? resolve(cwd, values.inputs) : fileURLToPath(HOSTINGER);
const out = resolve(cwd, values.out!);
// Clips are cached next to the inputs and committed, so the demo replays without a key.
const clipsDir = values.clips ? resolve(cwd, values.clips) : join(inputsDir, "clips");
const log = (s: string) => console.log(s);

const { brand, brief, page } = await loadInputs(inputsDir);
const ab = adBrief.parse(AD_BRIEF);

let writer: ConceptWriter;
if (values.concepts) {
  const saved = savedConcepts.parse(JSON.parse(await readFile(resolve(cwd, values.concepts), "utf8")));
  writer = fixedWriter(saved.concepts, saved.writer);
}
else if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) writer = claudeWriter({ model: values.model ?? process.env.LPH_ADS_MODEL });
else {
  console.error("Set ANTHROPIC_API_KEY to write scripts, or pass --concepts with a saved concepts.json.");
  process.exit(1);
}

const key = process.env.ELEVENLABS_API_KEY;
const voicer = cachedVoicer(key ? new ElevenLabs({ apiKey: key }) : null, clipsDir, { sttModel: values["stt-model"], languageCode: "en" });
const voice = { voiceId: values["voice-id"]!, voiceName: values["voice-name"]!, modelId: values["tts-model"]! };

const run = await runAds({ brand, brief, page, adBrief: ab, writer, voicer, voice, revise: !values["no-revise"], log });

// Outputs: the report, its clips and landing pages, the run as JSON, and the final scripts.
await mkdir(join(out, "clips"), { recursive: true });
for (const r of run.results) {
  if (r.clip) await copyFile(join(clipsDir, `${r.clip.key}.mp3`), join(out, "clips", `${r.concept.id}.mp3`));
  if (r.firstTake) await copyFile(join(clipsDir, `${r.firstTake.clip.key}.mp3`), join(out, "clips", `${r.concept.id}-take1.mp3`));
}
const uiCss = await readFile(createRequire(import.meta.url).resolve("@lph/ui/styles.css"), "utf8");
for (const v of renderVersions(page, brand, uiCss, { noindex: true })) {
  const file = join(out, "landing", `${v.path.replace(/^\//, "")}.html`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, v.html);
}
const evals = runEvals({ brand, brief, page });
const html = renderReport(run, { clipHref: (r, take) => `clips/${r.concept.id}${take === "first" ? "-take1" : ""}.mp3`, landingHref: (p) => `landing${p}.html`, evals });
await writeFile(join(out, "index.html"), html);
await writeFile(join(out, "results.json"), JSON.stringify({ ...run, evals }, null, 2));
await writeFile(join(out, "concepts.json"), JSON.stringify({ writer: run.writer, concepts: run.results.map((r) => r.concept) }, null, 2));
await writeFile(join(out, "evals.md"), evalsMarkdown(evals));

const ready = run.results.filter((r) => r.status === "ready").length;
log(`\n${ready} of ${run.results.length} ads ready. Report: ${join(out, "index.html")}`);
