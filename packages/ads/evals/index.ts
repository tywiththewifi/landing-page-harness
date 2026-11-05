import { checkAudio } from "../src/audio-check.ts";
import type { DemoInputs } from "../src/demo.ts";
import { gateConcept } from "../src/gate.ts";
import type { EvalRow } from "../src/report.ts";
import { adBrief } from "../src/schema.ts";
import { AD_BRIEF, AUDIO_CASES, GATE_CASES } from "./cases.ts";

/** Runs every eval case through the checks. No model or ElevenLabs calls. */
export function runEvals({ brand, brief, page }: DemoInputs): EvalRow[] {
  const ctx = { brand, brief, page, adBrief: adBrief.parse(AD_BRIEF) };
  const gate = GATE_CASES.map((c): EvalRow => {
    const r = gateConcept(c.concept, ctx);
    const fired = r.issues.filter((i) => i.severity === "error").map((i) => i.rule);
    return { kind: "gate", name: c.name, flaw: c.flaw, expected: c.rule, fired, ok: !r.pass && fired.includes(c.rule) };
  });
  const audio = AUDIO_CASES.map((c): EvalRow => {
    const r = checkAudio(c.script, c.transcript, { brandName: brand.name, seconds: ctx.adBrief.seconds });
    const fired = r.issues.filter((i) => i.severity === "error").map((i) => i.rule);
    return { kind: "audio", name: c.name, flaw: c.flaw, expected: c.rule, fired, ok: c.rule === null ? r.issues.length === 0 : !r.pass && fired.includes(c.rule) };
  });
  return [...gate, ...audio];
}

export function evalsMarkdown(rows: EvalRow[]): string {
  const line = (r: EvalRow) => `| ${r.kind} | \`${r.name}\` | ${r.flaw} | ${r.expected ? `\`${r.expected}\`` : "passes"} | ${r.ok ? "✅" : `❌ fired: ${r.fired.join(", ") || "nothing"}`} |`;
  return [`**${rows.filter((r) => r.ok).length}/${rows.length}** cases behave as expected.`, "", "| Check | Case | What's wrong | Expected | Result |", "|---|---|---|---|---|", ...rows.map(line)].join("\n");
}
