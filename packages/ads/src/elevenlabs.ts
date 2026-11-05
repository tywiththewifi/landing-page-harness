import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Transcript } from "./audio-check.ts";

/** Voice settings sent with each request. Unset fields use ElevenLabs' defaults. */
export interface VoiceSettings {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  speed?: number;
  use_speaker_boost?: boolean;
}

export interface SpeechRequest {
  text: string;
  voiceId: string;
  modelId: string;
  settings?: VoiceSettings;
  /** Defaults to mp3_44100_128, which every plan can use. */
  outputFormat?: string;
}

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const sorted = (o: object | undefined) => (o ? Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))) : {});

/**
 * The cache key for a clip: the exact text, voice, model, settings and format. Change
 * any of them and the clip is made again, so an edited script never plays stale audio.
 */
export function clipKey(req: SpeechRequest): string {
  const body = JSON.stringify({ text: req.text, voiceId: req.voiceId, modelId: req.modelId, settings: sorted(req.settings), outputFormat: req.outputFormat ?? "mp3_44100_128" });
  return createHash("sha256").update(body).digest("hex").slice(0, 24);
}

/**
 * The two ElevenLabs calls the ads need: text to speech and speech to text. The key
 * stays here, on the server; nothing in the published demo can reach it.
 */
export class ElevenLabs {
  readonly base: string;
  private readonly key: string;
  private readonly fetch: typeof fetch;

  constructor(opts: { apiKey: string; baseUrl?: string; fetch?: typeof fetch }) {
    if (!opts.apiKey) throw new ElevenLabsError("Set ELEVENLABS_API_KEY to voice the ads.", 401);
    this.key = opts.apiKey;
    this.base = opts.baseUrl ?? "https://api.elevenlabs.io";
    this.fetch = opts.fetch ?? fetch;
  }

  private async fail(res: Response, what: string): Promise<never> {
    const body = await res.text();
    let detail = body.slice(0, 300);
    try {
      const j = JSON.parse(body) as { detail?: { message?: string } | string };
      detail = typeof j.detail === "string" ? j.detail : (j.detail?.message ?? detail);
    } catch {}
    throw new ElevenLabsError(`${what} failed (${res.status}): ${detail}`, res.status);
  }

  /** POST /v1/text-to-speech/{voice_id}. Returns the audio bytes. */
  async speak(req: SpeechRequest): Promise<Uint8Array> {
    const url = `${this.base}/v1/text-to-speech/${encodeURIComponent(req.voiceId)}?output_format=${req.outputFormat ?? "mp3_44100_128"}`;
    const res = await this.fetch(url, {
      method: "POST",
      headers: { "xi-api-key": this.key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: req.text, model_id: req.modelId, ...(req.settings ? { voice_settings: req.settings } : {}) }),
    });
    if (!res.ok) return this.fail(res, "Voicing the script");
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * POST /v1/speech-to-text. No key terms are passed on purpose: hinting the brand's
   * name would make the transcript spell it right even when the voice says it wrong.
   */
  async transcribe(audio: Uint8Array, opts: { modelId?: string; languageCode?: string } = {}): Promise<Transcript> {
    const form = new FormData();
    form.set("model_id", opts.modelId ?? "scribe_v2");
    form.set("timestamps_granularity", "word");
    if (opts.languageCode) form.set("language_code", opts.languageCode);
    form.set("file", new Blob([audio as Uint8Array<ArrayBuffer>], { type: "audio/mpeg" }), "clip.mp3");
    const res = await this.fetch(`${this.base}/v1/speech-to-text`, { method: "POST", headers: { "xi-api-key": this.key }, body: form });
    if (!res.ok) return this.fail(res, "Transcribing the clip");
    return (await res.json()) as Transcript;
  }
}

export interface Voicer {
  speak(req: SpeechRequest): Promise<{ key: string; audio: Uint8Array; cached: boolean }>;
  transcribe(key: string, audio: Uint8Array): Promise<{ transcript: Transcript; cached: boolean }>;
}

/** Wraps the client with a folder cache, so re-running the demo costs nothing unless a script changed. */
export function cachedVoicer(client: ElevenLabs | null, dir: string, opts: { sttModel?: string; languageCode?: string } = {}): Voicer {
  const read = (f: string) => readFile(join(dir, f)).catch(() => null);
  const need = () => {
    if (!client) throw new ElevenLabsError("This clip isn't in the cache, and ELEVENLABS_API_KEY isn't set to make it.", 401);
    return client;
  };
  return {
    async speak(req) {
      const key = clipKey(req);
      const hit = await read(`${key}.mp3`);
      if (hit) return { key, audio: new Uint8Array(hit), cached: true };
      const audio = await need().speak(req);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${key}.mp3`), audio);
      await writeFile(join(dir, `${key}.json`), JSON.stringify({ ...req, createdAt: new Date().toISOString() }, null, 2));
      return { key, audio, cached: false };
    },
    async transcribe(key, audio) {
      const file = `${key}.${opts.sttModel ?? "scribe_v2"}.transcript.json`;
      const hit = await read(file);
      if (hit) return { transcript: JSON.parse(hit.toString()) as Transcript, cached: true };
      const transcript = await need().transcribe(audio, { modelId: opts.sttModel, languageCode: opts.languageCode });
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, file), JSON.stringify(transcript, null, 2));
      return { transcript, cached: false };
    },
  };
}
