import { beforeAll, describe, expect, it } from "vitest";
import { AD_BRIEF, GATE_CASES, GOOD, GOOD_SWITCHERS } from "../evals/cases.ts";
import type { Transcript } from "../src/audio-check.ts";
import { HOSTINGER, loadInputs, type DemoInputs } from "../src/demo.ts";
import { clipKey, type SpeechRequest, type Voicer } from "../src/elevenlabs.ts";
import { runAds } from "../src/run.ts";
import { adBrief, type AdConcept } from "../src/schema.ts";
import { fixedWriter, type ConceptWriter } from "../src/writer.ts";

let inputs: DemoInputs;
beforeAll(async () => {
  inputs = await loadInputs(HOSTINGER);
});

/** A voice that reads "$2.49" as "two point forty-nine" unless it's spelled out, like the first real run. */
function fakeVoicer() {
  const spoken: string[] = [];
  const texts = new Map<string, string>();
  const voicer: Voicer = {
    async speak(req: SpeechRequest) {
      spoken.push(req.text);
      const key = clipKey(req);
      texts.set(key, req.text.replace("$2.49", "two point forty-nine"));
      return { key, audio: new Uint8Array(16), cached: false };
    },
    async transcribe(key) {
      const transcript: Transcript = { text: texts.get(key)!, audio_duration_secs: 17 };
      return { transcript, cached: false };
    },
  };
  return { voicer, spoken };
}

const voice = { voiceId: "v", voiceName: "Test", modelId: "m" };

describe("runAds", () => {
  it("never voices a blocked script", async () => {
    const { voicer, spoken } = fakeVoicer();
    const bad = GATE_CASES.find((c) => c.name === "wrong-price")!.concept;
    const run = await runAds({ ...inputs, adBrief: adBrief.parse(AD_BRIEF), writer: fixedWriter([bad, GOOD_SWITCHERS]), voicer, voice });
    expect(run.results.map((r) => r.status)).toEqual(["blocked", "ready"]);
    expect(spoken).toEqual([GOOD_SWITCHERS.script]);
  });

  it("rewrites a blocked script once with the gate's reasons", async () => {
    const { voicer } = fakeVoicer();
    const bad = GATE_CASES.find((c) => c.name === "hype")!.concept;
    let reasons: string[] = [];
    const writer: ConceptWriter = {
      name: "test",
      write: async () => [bad],
      revise: async (_i, c: AdConcept, issues) => {
        reasons = issues.map((i) => i.rule);
        return { ...GOOD, id: c.id, version: c.version };
      },
    };
    const run = await runAds({ ...inputs, adBrief: adBrief.parse(AD_BRIEF), writer, voicer, voice });
    expect(reasons).toContain("tone.hype");
    expect(run.results[0]?.firstDraft?.gate.pass).toBe(false);
    expect(run.results[0]?.gate.pass).toBe(true);
  });

  it("voices a misread price again, spelled out, and still checks against the approved script", async () => {
    const { voicer, spoken } = fakeVoicer();
    const run = await runAds({ ...inputs, adBrief: adBrief.parse(AD_BRIEF), writer: fixedWriter([GOOD]), voicer, voice });
    const r = run.results[0]!;
    expect(r.firstTake?.audio.issues.map((i) => i.rule)).toContain("audio.number-misread");
    expect(spoken).toEqual([GOOD.script, r.spokenText]);
    expect(r.spokenText).toContain("two dollars and forty-nine cents");
    expect(r.status).toBe("ready");
  });

  it("keys the cache on text, voice, model and settings", () => {
    const req = { text: "Hi", voiceId: "a", modelId: "m", settings: { stability: 0.5, speed: 1 } };
    expect(clipKey(req)).toBe(clipKey({ ...req, settings: { speed: 1, stability: 0.5 } }));
    expect(clipKey(req)).not.toBe(clipKey({ ...req, text: "Hi." }));
    expect(clipKey(req)).not.toBe(clipKey({ ...req, voiceId: "b" }));
    expect(clipKey(req)).not.toBe(clipKey({ ...req, modelId: "n" }));
    expect(clipKey(req)).not.toBe(clipKey({ ...req, settings: { stability: 0.6, speed: 1 } }));
  });
});
