import { align, type Transcript } from "./audio-check.ts";
import type { AdIssue } from "./schema.ts";
import type { AdResult, AdRun } from "./run.ts";
import { speechTokens } from "./spoken.ts";

export interface EvalRow {
  kind: "gate" | "audio";
  name: string;
  flaw: string;
  /** The rule that should fire, or null when the case should pass. */
  expected: string | null;
  /** The error rules that did fire. */
  fired: string[];
  ok: boolean;
}

export interface ReportOptions {
  /** Where a clip is served from, relative to the report. */
  clipHref: (r: AdResult, take: "final" | "first") => string;
  /** Where a landing page version is served from, relative to the report. */
  landingHref: (path: string) => string;
  evals?: EvalRow[];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** What the gate looks at, for listing the checks an ad passed. */
const GATE_CHECKS: [prefix: string, label: string][] = [
  ["number", "Every number is on the site or in the request"],
  ["claim", "Every claim uses the site's own words"],
  ["tone", "Sounds like the brand: no hype, shouting or exclamation marks it doesn't use"],
  ["length", "Fits the slot, estimated from spoken words"],
  ["brand", "Says the brand's name, spelled right"],
  ["words", "Avoids names the brief rules out"],
  ["cta", "Says the call to action, and it matches the page's button"],
  ["landing", "Points at a real version of the landing page, with a matching headline"],
  ["speech", "No symbols a voice would read aloud"],
  ["placeholder", "Nothing left unwritten"],
];

const AUDIO_CHECKS: [prefix: string, label: string][] = [
  ["audio.number", "Every price and number is said as written"],
  ["audio.brand", "The brand's name comes back spelled right"],
  ["audio.symbol", "No symbol read aloud"],
  ["audio.too", "The clip fits the slot, measured"],
  ["audio.words", "The words match the script"],
];

function checklist(checks: [string, string][], issues: AdIssue[]) {
  return `<ul class="checks">${checks
    .map(([prefix, label]) => {
      const hit = issues.filter((i) => i.rule === prefix || i.rule.startsWith(`${prefix}.`) || i.rule.startsWith(prefix));
      const worst = hit.some((i) => i.severity === "error") ? "fail" : hit.length ? "warn" : "pass";
      const mark = worst === "pass" ? "Pass" : worst === "warn" ? "Note" : "Fail";
      return `<li class="${worst}"><span class="mark">${mark}</span><span>${esc(label)}${hit.map((i) => `<span class="why">${esc(i.message)}</span>`).join("")}</span></li>`;
    })
    .join("")}</ul>`;
}

/** The clip's measured length against the slot, drawn to scale. */
function slotBar(seconds: number | null, estimated: number, slot: { min: number; max: number }) {
  const end = Math.ceil(Math.max(slot.max + 5, (seconds ?? 0) + 2, estimated + 2) / 5) * 5;
  const W = 320;
  const x = (s: number) => 8 + (s / end) * (W - 16);
  const ticks = [0, slot.min, slot.max, end].filter((t, i, a) => a.indexOf(t) === i);
  const bar = seconds ?? estimated;
  return `<figure class="slot">
  <svg viewBox="0 0 ${W} 44" role="img" aria-label="${seconds != null ? `Clip runs ${seconds.toFixed(1)} seconds` : `Estimated ${estimated} seconds`}; the slot is ${slot.min} to ${slot.max} seconds">
    <rect x="${x(slot.min)}" y="4" width="${x(slot.max) - x(slot.min)}" height="20" rx="3" class="win"/>
    <rect x="${x(0)}" y="10" width="${Math.max(2, x(bar) - x(0))}" height="8" rx="2" class="${bar > slot.max ? "over" : "len"}"/>
    <line x1="${x(estimated)}" x2="${x(estimated)}" y1="4" y2="24" class="est"/>
    ${ticks.map((t) => `<text x="${x(t)}" y="38" text-anchor="middle">${t}s</text>`).join("")}
  </svg>
  <figcaption>${seconds != null ? `Measured <b>${seconds.toFixed(1)} s</b> · ` : ""}estimated ${estimated} s before voicing · slot ${slot.min}–${slot.max} s</figcaption>
</figure>`;
}

/** The script against what speech to text heard, word by word. */
function diff(script: string, transcript: Transcript) {
  return align(speechTokens(script), speechTokens(transcript.text))
    .map((o) => (o.kind === "same" ? esc(o.a!) : o.kind === "sub" ? `<del>${esc(o.a!)}</del> <ins>${esc(o.b!)}</ins>` : o.kind === "del" ? `<del>${esc(o.a!)}</del>` : `<ins>${esc(o.b!)}</ins>`))
    .join(" ");
}

const STATUS: Record<AdResult["status"], [string, string]> = {
  ready: ["ready", "Ready for review"],
  blocked: ["blocked", "Blocked before voicing"],
  "failed-audio": ["blocked", "Clip doesn't match script"],
};

function scriptHtml(r: AdResult) {
  const s = esc(r.concept.script);
  const cta = esc(r.concept.cta);
  return cta && s.includes(cta) ? s.replace(cta, `<mark>${cta}</mark>`) : s;
}

function adCard(r: AdResult, i: number, run: AdRun, opts: ReportOptions) {
  const [cls, label] = STATUS[r.status];
  const slot = run.adBrief.seconds;
  return `<article class="ad" id="ad-${esc(r.concept.id)}">
  <header class="ad-head">
    <div class="ad-title">
      <p class="eyebrow">Ad ${i + 1} · ${esc(r.landing?.name ?? "Unknown page")}</p>
      <h2>${esc(r.concept.angle)}</h2>
    </div>
    <span class="pill ${cls}">${label}</span>
  </header>
  <div class="ad-body">
    <div class="ad-main">
      <p class="headline">“${esc(r.concept.headline)}”</p>
      ${r.clip ? `<audio controls preload="none" src="${esc(opts.clipHref(r, "final"))}"></audio><p class="ai-label">AI-generated voice · ElevenLabs ${esc(run.voice.voiceName)}${r.firstTake ? " · second take" : ""}</p>` : `<p class="no-clip">Not voiced: the gate blocked it, so it cost nothing.</p>`}
      <blockquote class="script">${scriptHtml(r)}</blockquote>
      ${r.landing ? `<p class="landing">Landing page: <a href="${esc(opts.landingHref(r.landing.path))}" target="_blank" rel="noopener">${esc(r.landing.path)}</a></p>` : ""}
      ${slotBar(r.audio?.seconds ?? null, r.gate.seconds, slot)}
      ${
        r.firstTake
          ? `<details class="draft" open><summary>First take failed the audio check, so it was voiced again</summary>
        <audio controls preload="none" src="${esc(opts.clipHref(r, "first"))}"></audio>
        ${checklist(AUDIO_CHECKS, r.firstTake.audio.issues)}
        <p class="meta">The second take gave the voice the prices and percentages in words. The clip was still checked against the approved script:</p>
        <blockquote class="script">${esc(r.spokenText ?? "")}</blockquote></details>`
          : ""
      }
      ${
        r.firstDraft
          ? `<details class="draft"><summary>First draft was blocked, then rewritten</summary><blockquote class="script">${esc(r.firstDraft.concept.script)}</blockquote>${checklist(GATE_CHECKS, r.firstDraft.gate.issues)}</details>`
          : ""
      }
    </div>
    <div class="ad-checks">
      <section>
        <h3>Before voicing</h3>
        ${checklist(GATE_CHECKS, r.gate.issues)}
      </section>
      ${
        r.audio && r.transcript
          ? `<section>
        <h3>After voicing</h3>
        ${checklist(AUDIO_CHECKS, r.audio.issues)}
        <p class="meta">Word error rate ${(r.audio.wordErrorRate * 100).toFixed(1)}% · transcribed with ElevenLabs speech to text</p>
        <details class="heard"><summary>Script against what was heard</summary><p class="diff">${diff(r.concept.script, r.transcript)}</p></details>
      </section>`
          : ""
      }
    </div>
  </div>
</article>`;
}

function evalTable(rows: EvalRow[], kind: EvalRow["kind"]) {
  const shown = rows.filter((r) => r.kind === kind);
  if (!shown.length) return "";
  return `<div class="table-wrap"><table>
  <thead><tr><th scope="col">Case</th><th scope="col">What's wrong</th><th scope="col">Expected</th><th scope="col">Result</th></tr></thead>
  <tbody>${shown
    .map(
      (r) =>
        `<tr><td class="mono">${esc(r.name)}</td><td>${esc(r.flaw)}</td><td class="mono">${esc(r.expected ?? "passes")}</td><td><span class="pill ${r.ok ? "ready" : "blocked"}">${r.ok ? (r.expected ? "Caught" : "Passed") : "Missed"}</span></td></tr>`,
    )
    .join("")}</tbody>
</table></div>`;
}

/**
 * The results page: each ad with its clip, the checks before and after voicing, and a
 * link to its landing page, then the evals. One self-contained HTML file; clips and
 * landing pages sit beside it.
 */
export function renderReport(run: AdRun, opts: ReportOptions): string {
  const n = run.results.length;
  const passedGate = run.results.filter((r) => r.gate.pass).length;
  const rewritten = run.results.filter((r) => r.firstDraft && r.gate.pass).length;
  const voiced = run.results.filter((r) => r.clip).length;
  const retakes = run.results.filter((r) => r.firstTake).length;
  const ready = run.results.filter((r) => r.status === "ready").length;
  const evals = opts.evals ?? [];
  const caught = evals.filter((e) => e.ok).length;
  const date = run.createdAt.slice(0, 10);
  return `<title>${esc(run.brand.name)} Audio Ads</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Layout: one review column; each ad is a sheet with the take on the left and its checks on the right. */
:root {
  --paper: #f5f6f8; --sheet: #ffffff; --ink: #15171c; --soft: #5a606d; --rule: #dfe2e8;
  --accent: #3245c9; --accent-soft: #e6e9fb;
  --pass: #1d7a4b; --pass-bg: #e3f3ea; --warn: #8a5a00; --warn-bg: #fbf0d9; --fail: #b3261e; --fail-bg: #fbe5e3;
  --win: #dfe5fb; --mark: #fff1b8;
  --sans: "Instrument Sans", "Helvetica Neue", Arial, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --paper: #111318; --sheet: #191c23; --ink: #e9ebf0; --soft: #a2a8b6; --rule: #2c303a;
  --accent: #8e9cff; --accent-soft: #252a4a;
  --pass: #6fd29d; --pass-bg: #163325; --warn: #f0c060; --warn-bg: #3a2e12; --fail: #ff8f86; --fail-bg: #3d1a18;
  --win: #262d4d; --mark: #4a4120; color-scheme: dark;
} }
:root[data-theme="dark"] {
  --paper: #111318; --sheet: #191c23; --ink: #e9ebf0; --soft: #a2a8b6; --rule: #2c303a;
  --accent: #8e9cff; --accent-soft: #252a4a;
  --pass: #6fd29d; --pass-bg: #163325; --warn: #f0c060; --warn-bg: #3a2e12; --fail: #ff8f86; --fail-bg: #3d1a18;
  --win: #262d4d; --mark: #4a4120; color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.55 var(--sans); }
.wrap { max-width: 1080px; margin: 0 auto; padding-block: 40px 64px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: grid; gap: 32px; }
h1, h2, h3 { text-wrap: balance; margin: 0; line-height: 1.2; }
h1 { font-size: clamp(2rem, 4vw, 2.75rem); font-weight: 700; letter-spacing: -0.02em; }
h2 { font-size: 1.35rem; font-weight: 600; }
h3 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--soft); font-weight: 600; }
a { color: var(--accent); }
a:focus-visible, summary:focus-visible, audio:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.eyebrow { margin: 0; font: 500 0.75rem/1.4 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--soft); }
.intro { display: grid; gap: 14px; max-width: 70ch; }
.intro p { margin: 0; }
.lede { font-size: 1.1rem; }
.notice { font-size: 0.9rem; color: var(--soft); border-left: 3px solid var(--rule); padding-left: 12px; }
.flow { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; font: 0.85rem/1.3 var(--mono); }
.flow li { background: var(--sheet); border: 1px solid var(--rule); border-radius: 6px; padding: 8px 12px; font-variant-numeric: tabular-nums; }
.flow b { font-weight: 500; color: var(--accent); }
.ad { background: var(--sheet); border: 1px solid var(--rule); border-radius: 10px; padding: 24px; display: grid; gap: 20px; }
.ad-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: start; gap: 12px; }
.ad-title { display: grid; gap: 4px; min-width: 0; }
.ad-body { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 28px; }
.ad-main, .ad-checks { display: grid; gap: 14px; align-content: start; min-width: 0; }
.ad-checks section { display: grid; gap: 10px; }
.headline { margin: 0; font-size: 1.15rem; font-weight: 600; }
audio { width: 100%; }
.ai-label, .meta, .landing, .no-clip { margin: 0; font-size: 0.85rem; color: var(--soft); }
.ai-label { font-family: var(--mono); font-size: 0.75rem; letter-spacing: 0.02em; }
.script { margin: 0; padding: 14px 16px; background: var(--paper); border-radius: 8px; font-size: 1rem; line-height: 1.6; }
mark { background: var(--mark); color: inherit; padding: 0 2px; border-radius: 2px; }
.pill { display: inline-block; font: 500 0.75rem/1 var(--mono); padding: 6px 10px; border-radius: 999px; white-space: nowrap; }
.pill.ready { background: var(--pass-bg); color: var(--pass); }
.pill.blocked { background: var(--fail-bg); color: var(--fail); }
.checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 0.9rem; }
.checks li { display: grid; grid-template-columns: 3.4rem minmax(0, 1fr); gap: 8px; align-items: baseline; }
.checks .mark { font: 500 0.7rem/1 var(--mono); text-transform: uppercase; letter-spacing: 0.05em; padding: 4px 0; text-align: center; border-radius: 4px; }
.checks .pass .mark { color: var(--pass); background: var(--pass-bg); }
.checks .warn .mark { color: var(--warn); background: var(--warn-bg); }
.checks .fail .mark { color: var(--fail); background: var(--fail-bg); }
.why { display: block; color: var(--soft); font-size: 0.85rem; margin-top: 2px; }
.slot { margin: 0; display: grid; gap: 2px; }
.slot svg { width: 100%; max-width: 420px; height: auto; display: block; }
.slot .win { fill: var(--win); }
.slot .len { fill: var(--accent); }
.slot .over { fill: var(--fail); }
.slot .est { stroke: var(--soft); stroke-width: 1.5; stroke-dasharray: 2 2; }
.slot text { fill: var(--soft); font: 10px var(--mono); }
.slot figcaption { font: 0.75rem/1.4 var(--mono); color: var(--soft); font-variant-numeric: tabular-nums; }
details { font-size: 0.9rem; }
summary { cursor: pointer; color: var(--accent); }
details[open] > summary { margin-bottom: 10px; }
.draft { border-top: 1px solid var(--rule); padding-top: 12px; display: grid; gap: 10px; }
.diff { margin: 0; font: 0.8rem/1.8 var(--mono); }
del { color: var(--fail); background: var(--fail-bg); text-decoration: line-through; }
ins { color: var(--pass); background: var(--pass-bg); text-decoration: none; }
.evals { display: grid; gap: 16px; }
.evals > p { margin: 0; max-width: 70ch; }
.table-wrap { overflow-x: auto; background: var(--sheet); border: 1px solid var(--rule); border-radius: 10px; }
table { border-collapse: collapse; width: 100%; font-size: 0.88rem; }
th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--rule); vertical-align: top; }
tr:last-child td { border-bottom: 0; }
th { font: 600 0.72rem/1.3 var(--sans); text-transform: uppercase; letter-spacing: 0.06em; color: var(--soft); }
.mono { font-family: var(--mono); font-size: 0.8rem; white-space: nowrap; }
.how { display: grid; gap: 10px; max-width: 70ch; }
.how ol { margin: 0; padding-left: 1.3em; display: grid; gap: 6px; }
.how p { margin: 0; color: var(--soft); font-size: 0.9rem; }
@media (max-width: 760px) { .ad-body { grid-template-columns: minmax(0, 1fr); } .ad { padding: 18px; } }
</style>
<main class="wrap">
  <header class="intro">
    <p class="eyebrow">Softlander · audio ad concepts · ${esc(date)}</p>
    <h1>${esc(run.brand.name)} audio ads</h1>
    <p class="lede">${n} ads of ${run.adBrief.seconds.min} to ${run.adBrief.seconds.max} seconds, written from ${esc(new URL(run.brand.url).hostname)} and the landing page's brief. Each was checked before it was voiced, voiced with ElevenLabs, then transcribed and checked again against its script.</p>
    <p class="notice">A concept made for a job application, not by or for ${esc(run.brand.name)}. Every clip is AI-generated with ElevenLabs' stock voice ${esc(run.voice.voiceName)} (${esc(run.voice.modelId)}). Scripts written by ${run.writer.name === "claude" ? `Claude (${esc(run.writer.model ?? "")})` : "hand"}; nobody edited them.</p>
    <ol class="flow" aria-label="Pipeline">
      <li>Written <b>${n}</b></li>
      <li>Passed the gate <b>${passedGate}</b>${rewritten ? ` (${rewritten} after a rewrite)` : ""}</li>
      <li>Voiced <b>${voiced}</b>${retakes ? ` (${retakes} voiced twice)` : ""}</li>
      <li>Passed the audio check <b>${ready}</b></li>
      ${evals.length ? `<li>Evals caught <b>${caught}/${evals.length}</b></li>` : ""}
    </ol>
  </header>
  ${run.results.map((r, i) => adCard(r, i, run, opts)).join("\n")}
  ${
    evals.length
      ? `<section class="evals" id="evals">
    <h2>What the checks catch</h2>
    <p>Each case is a script or a clip broken in one specific way. They run in CI on every change with no calls to Claude or ElevenLabs; the clips are stood in for by the transcripts they would produce.</p>
    <h3>Before voicing</h3>
    ${evalTable(evals, "gate")}
    <h3>After voicing</h3>
    ${evalTable(evals, "audio")}
  </section>`
      : ""
  }
  <section class="how">
    <h2>How it works</h2>
    <ol>
      <li>Softlander reads the brand's site and keeps every page's headings and copy as the source of truth.</li>
      <li>Claude writes one ad per version of the landing page, under the same grounding rules as the page.</li>
      <li>The gate checks each script with plain rules, no model. A blocked script goes back to Claude once with the reasons.</li>
      <li>Scripts that pass are voiced. Each clip is cached under its text, voice, model and settings, so an edited script is never played from stale audio.</li>
      <li>Each clip is transcribed and compared word by word with its script. Numbers, the brand's name and the length are checked on what was actually said.</li>
    </ol>
    <p>Not included: video, music, sound effects, ad platforms, or learning from results.</p>
  </section>
</main>
`;
}
