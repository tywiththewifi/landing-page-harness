import type { Brief } from "@lph/brief";
import type { Page } from "@lph/page";
import type { Brand } from "@lph/tokens";
import { checkAudio, type AudioCheckResult, type Transcript } from "./audio-check.ts";
import type { Voicer, VoiceSettings } from "./elevenlabs.ts";
import { gateConcept, landingFor, type GateResult } from "./gate.ts";
import { speakable } from "./spoken.ts";
import type { AdBrief, AdConcept } from "./schema.ts";
import type { ConceptWriter } from "./writer.ts";

export interface VoiceChoice {
  voiceId: string;
  /** For people: the voice's name in ElevenLabs' library. */
  voiceName: string;
  modelId: string;
  settings?: VoiceSettings;
}

export interface AdResult {
  concept: AdConcept;
  landing: { name: string; path: string } | null;
  gate: GateResult;
  /** The first draft and why the gate blocked it, when the writer rewrote it. */
  firstDraft?: { concept: AdConcept; gate: GateResult };
  clip?: { key: string; cached: boolean; bytes: number };
  /** What the voice was given, when it differs from the approved script (prices spelled out). */
  spokenText?: string;
  transcript?: Transcript;
  audio?: AudioCheckResult;
  /** The first take, when the audio check failed it on a number and the ad was voiced again. */
  firstTake?: { clip: { key: string; cached: boolean; bytes: number }; transcript: Transcript; audio: AudioCheckResult };
  /** ready: passed both checks. blocked: failed the gate, never voiced. failed-audio: voiced, but the clip doesn't match the script. */
  status: "ready" | "blocked" | "failed-audio";
}

export interface AdRun {
  brand: { id: string; name: string; url: string };
  adBrief: AdBrief;
  writer: { name: string; model?: string };
  voice: VoiceChoice;
  createdAt: string;
  results: AdResult[];
}

export interface RunInput {
  brand: Brand;
  brief: Brief;
  page: Page;
  adBrief: AdBrief;
  writer: ConceptWriter;
  voicer: Voicer;
  voice: VoiceChoice;
  /** Rewrites a blocked concept once with the gate's reasons. On by default when the writer can. */
  revise?: boolean;
  log?: (line: string) => void;
}

/**
 * Brief in, checked audio ads out: write one concept per landing page version, gate
 * each before it costs anything to voice (rewriting a blocked one once), voice what
 * passes, then transcribe each clip and compare it with its script.
 */
export async function runAds(input: RunInput): Promise<AdRun> {
  const { brand, brief, page, adBrief, writer, voicer, voice } = input;
  const log = input.log ?? (() => {});
  const ctx = { brand, page, adBrief, brief };

  log(`Concepts from ${writer.name}${writer.model ? ` (${writer.model})` : ""}...`);
  const concepts = await writer.write({ brand, brief, page, adBrief });
  const results: AdResult[] = [];

  for (const first of concepts) {
    let concept = first;
    let gate = gateConcept(concept, ctx);
    let firstDraft: AdResult["firstDraft"];
    log(`Gate ${concept.id}: ${gate.pass ? "pass" : `blocked (${gate.issues.filter((i) => i.severity === "error").map((i) => i.rule).join(", ")})`}`);
    if (!gate.pass && writer.revise && input.revise !== false) {
      firstDraft = { concept, gate };
      concept = await writer.revise({ brand, brief, page, adBrief }, concept, gate.issues);
      gate = gateConcept(concept, ctx);
      log(`Gate ${concept.id} after rewrite: ${gate.pass ? "pass" : "still blocked"}`);
    }
    const l = landingFor(page, concept.version);
    const result: AdResult = { concept, landing: l && { name: l.name, path: l.path }, gate, ...(firstDraft ? { firstDraft } : {}), status: "blocked" };
    results.push(result);
    if (!gate.pass) continue;

    const take = async (text: string) => {
      const { key, audio, cached } = await voicer.speak({ text, voiceId: voice.voiceId, modelId: voice.modelId, settings: voice.settings });
      const { transcript } = await voicer.transcribe(key, audio);
      // Always compared with the approved script, whatever text the voice was given.
      const check = checkAudio(concept.script, transcript, { brandName: brand.name, seconds: adBrief.seconds });
      log(`Voiced ${concept.id}${cached ? " (cached)" : ""}: ${check.pass ? "audio check passed" : check.issues.filter((i) => i.severity === "error").map((i) => i.rule).join(", ")}`);
      return { clip: { key, cached, bytes: audio.byteLength }, transcript, audio: check };
    };
    let voiced = await take(concept.script);
    // A misread number is usually the voice guessing how to say "$2.49". Spell it out once and try again.
    const spoken = speakable(concept.script);
    if (voiced.audio.issues.some((i) => i.rule === "audio.number-misread") && spoken !== concept.script) {
      result.firstTake = voiced;
      result.spokenText = spoken;
      voiced = await take(spoken);
    }
    Object.assign(result, voiced);
    result.status = voiced.audio.pass ? "ready" : "failed-audio";
  }

  return {
    brand: { id: brand.id, name: brand.name, url: brand.url },
    adBrief,
    writer: { name: writer.name, ...(writer.model ? { model: writer.model } : {}) },
    voice,
    createdAt: new Date().toISOString(),
    results,
  };
}
