import type { AdBrief, AdIssue } from "./schema.ts";
import { isNumberToken, speechTokens } from "./spoken.ts";

/** What speech to text returns: the words heard, with times in seconds. */
export interface Transcript {
  text: string;
  words?: { text: string; start?: number | null; end?: number | null; type?: string }[];
  audio_duration_secs?: number;
}

/** A stretch where the voice didn't say what the script says. */
export interface Difference {
  expected: string;
  heard: string;
}

export interface AudioCheckResult {
  pass: boolean;
  issues: AdIssue[];
  /** Measured length of the clip. */
  seconds: number | null;
  /** Share of script words the voice changed, dropped or added (word error rate). */
  wordErrorRate: number;
  differences: Difference[];
}

type Op = { kind: "same" | "sub" | "del" | "ins"; a?: string; b?: string };

/** Word-level alignment of what should have been said (a) with what was heard (b). */
export function align(a: string[], b: string[]): Op[] {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  const ops: Op[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i]![j] === d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      ops.push({ kind: a[i - 1] === b[j - 1] ? "same" : "sub", a: a[i - 1], b: b[j - 1] });
      i--, j--;
    } else if (i > 0 && d[i]![j] === d[i - 1]![j]! + 1) {
      ops.push({ kind: "del", a: a[i - 1] });
      i--;
    } else {
      ops.push({ kind: "ins", b: b[j - 1] });
      j--;
    }
  }
  return ops.reverse();
}

/** Runs of changed words, as "expected" and "heard" phrases. */
export function differences(ops: Op[]): Difference[] {
  const out: Difference[] = [];
  let cur: { a: string[]; b: string[] } | null = null;
  for (const op of [...ops, { kind: "same" } as Op]) {
    if (op.kind === "same") {
      if (cur) out.push({ expected: cur.a.join(" "), heard: cur.b.join(" ") });
      cur = null;
      continue;
    }
    cur ??= { a: [], b: [] };
    if (op.a) cur.a.push(op.a);
    if (op.b) cur.b.push(op.b);
  }
  return out;
}

const count = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());

/** Words a voice says when it reads a symbol instead of what the symbol means. */
const SYMBOL_WORDS = new Set(["slash", "ampersand", "hashtag", "asterisk", "underscore", "backslash", "pipe", "tilde"]);

/**
 * Compares a voiced clip with the script it was voiced from, using a transcript of the
 * clip. Catches what a listener would notice and the text checks can't: a price or
 * number read wrong, the brand's name mispronounced (the transcript spells what it
 * heard), a symbol read aloud, words dropped, and a clip that runs over its slot.
 */
export function checkAudio(script: string, transcript: Transcript, opts: { brandName: string; seconds: AdBrief["seconds"] }): AudioCheckResult {
  const issues: AdIssue[] = [];
  const add = (severity: AdIssue["severity"], rule: string, message: string) => issues.push({ rule, severity, message });
  const expected = speechTokens(script);
  const heard = speechTokens(transcript.text);
  const ops = align(expected, heard);
  const diffs = differences(ops);
  const errors = ops.filter((o) => o.kind !== "same").length;
  const wordErrorRate = expected.length ? Math.round((errors / expected.length) * 1000) / 1000 : heard.length ? 1 : 0;
  const where = (token: string) => diffs.find((d) => d.expected.split(" ").includes(token) || d.heard.split(" ").includes(token));
  const quote = (d: Difference | undefined) => (d ? ` The script says "${d.expected || "(nothing)"}"; the voice said "${d.heard || "(nothing)"}".` : "");

  if (!heard.length) add("error", "audio.silent", "No speech was heard in the clip.");

  // Numbers: the same ones, as many times, in the clip as in the script
  const want = count(expected.filter(isNumberToken));
  const got = count(heard.filter(isNumberToken));
  for (const [n, k] of want) if ((got.get(n) ?? 0) < k) add("error", "audio.number-misread", `"${n}" isn't said the way the script has it.${quote(where(n))}`);
  for (const [n, k] of got) if ((want.get(n) ?? 0) < k) {
    const d = where(n);
    if (!d || !issues.some((i) => i.message.includes(`"${d.heard}"`))) add("error", "audio.number-misread", `The voice says "${n}", which isn't in the script.${quote(d)}`);
  }

  // The brand's name: a mispronounced name comes back spelled differently
  const name = speechTokens(opts.brandName).join(" ");
  const said = (toks: string[]) => ` ${toks.join(" ")} `.split(` ${name} `).length - 1;
  if (said(heard) < said(expected)) {
    const d = diffs.find((x) => ` ${x.expected} `.includes(` ${name} `));
    add("error", "audio.brand-misread", `"${opts.brandName}" is in the script ${said(expected)} time${said(expected) === 1 ? "" : "s"} but heard ${said(heard)}.${quote(d)} Add the name to a pronunciation dictionary or respell it for the voice.`);
  }

  // Symbols read aloud
  const symbols = heard.filter((w) => SYMBOL_WORDS.has(w) && !expected.includes(w));
  if (symbols.length) add("error", "audio.symbol-read", `The voice read a symbol aloud: "${symbols.join('", "')}". Write it as words in the script.`);

  // Length, measured
  const lastWord = [...(transcript.words ?? [])].reverse().find((w) => (w.type ?? "word") === "word" && w.end != null);
  const seconds = transcript.audio_duration_secs ?? lastWord?.end ?? null;
  if (seconds != null) {
    const s = Math.round(seconds * 10) / 10;
    if (s > opts.seconds.max) add("error", "audio.too-long", `The clip runs ${s} seconds; the slot is ${opts.seconds.min} to ${opts.seconds.max}.`);
    else if (s < opts.seconds.min) add("warning", "audio.too-short", `The clip runs ${s} seconds; the slot is ${opts.seconds.min} to ${opts.seconds.max}.`);
  }

  // Everything else that changed
  if (wordErrorRate > 0.2) add("error", "audio.words-changed", `${Math.round(wordErrorRate * 100)}% of the words differ from the script.`);
  else if (wordErrorRate > 0.05) add("warning", "audio.words-changed", `${Math.round(wordErrorRate * 100)}% of the words differ from the script: ${diffs.slice(0, 3).map((d) => `"${d.expected}" → "${d.heard}"`).join(", ")}.`);

  return { pass: !issues.some((i) => i.severity === "error"), issues, seconds, wordErrorRate, differences: diffs };
}
