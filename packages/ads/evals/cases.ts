import type { Transcript } from "../src/audio-check.ts";
import type { AdBriefInput, AdConcept } from "../src/schema.ts";

/**
 * Evals for the checks, on the Hostinger demo data. None of them call a model or
 * ElevenLabs: the scripts are written to fail in one specific way each, and the
 * transcripts stand in for what speech to text would hear.
 */

export const AD_BRIEF: AdBriefInput = {
  prompt: "15 to 20 second audio ads for podcasts and streaming that send small business owners to the online store page.",
  seconds: { min: 15, max: 20 },
  avoid: ["Shopify", "Wix", "Squarespace", "GoDaddy"],
};

/** A script that passes, and the base the bad ones are made from. */
export const GOOD: AdConcept = {
  id: "first-store",
  angle: "Never built a website",
  version: "first-time-sellers",
  headline: "Your first online store, built with AI",
  script:
    "Never built a website? Describe what you sell, and Hostinger's AI builds your online store in seconds. Customize it with drag and drop, then sell with zero percent transaction fees. Plans start from $2.49 a month. Choose plan at hostinger.com.",
  cta: "Choose plan",
};

export const GOOD_SWITCHERS: AdConcept = {
  id: "move-store",
  angle: "Tired of fees on every sale",
  version: "store-switchers",
  headline: "Move your online store and keep what you earn",
  script:
    "Paying fees on every sale? Move your online store to Hostinger. Tell Hostinger Agent you want to move your site and get help every step of the way. Then sell with zero percent transaction fees and over 100 payment methods. Choose plan at hostinger.com.",
  cta: "Choose plan",
};

export interface GateCase {
  name: string;
  /** What's wrong with it, in a reviewer's words. */
  flaw: string;
  concept: AdConcept;
  /** The rule that must block it. */
  rule: string;
}

const bad = (patch: Partial<AdConcept>): AdConcept => ({ ...GOOD, ...patch });

export const GATE_CASES: GateCase[] = [
  {
    name: "invented-statistic",
    flaw: "Claims a customer count the site never gives",
    rule: "number.unsourced",
    concept: bad({ script: GOOD.script.replace("Never built a website?", "Join 3 million sellers who never built a website.") }),
  },
  {
    name: "wrong-price",
    flaw: "Says $1.99 a month; the site says from $2.49",
    rule: "number.unsourced",
    concept: bad({ script: GOOD.script.replace("$2.49", "$1.99") }),
  },
  {
    name: "spelled-out-statistic",
    flaw: "An invented percentage written in words, so a digits-only check would miss it",
    rule: "number.unsourced",
    concept: bad({ script: GOOD.script.replace("Customize it with drag and drop,", "Ninety percent of stores launch on day one,") }),
  },
  {
    name: "superlative",
    flaw: "Calls Hostinger the fastest builder, which the site doesn't claim",
    rule: "claim.unsourced",
    concept: bad({ script: GOOD.script.replace("Hostinger's AI builds", "Hostinger, the fastest website builder around, builds") }),
  },
  {
    name: "guarantee",
    flaw: "Promises a Google ranking",
    rule: "claim.unsourced",
    concept: bad({ script: GOOD.script.replace("Plans start", "Your store is guaranteed to rank on Google. Plans start") }),
  },
  {
    name: "hype",
    flaw: "Hype words Hostinger's copy never uses",
    rule: "tone.hype",
    concept: bad({ script: GOOD.script.replace("Never built a website?", "This deal is insane and totally game-changing.") }),
  },
  {
    name: "shouting",
    flaw: "Capitals for emphasis",
    rule: "tone.shouting",
    concept: bad({ script: GOOD.script.replace("zero percent", "ZERO percent") }),
  },
  {
    name: "too-long",
    flaw: "About 30 seconds of copy for a 20-second slot",
    rule: "length.too-long",
    concept: bad({
      script: `${GOOD.script.replace(" Choose plan at hostinger.com.", "")} You also get a free domain for 1 year with yearly plans, built-in marketing and SEO tools, AI that writes product titles and descriptions, and Hostinger Agent to migrate, fix, edit and manage your site through chat. Choose plan at hostinger.com.`,
    }),
  },
  {
    name: "misspelled-brand",
    flaw: "The brand name is misspelled, so the voice would say it wrong",
    rule: "brand.misspelled",
    concept: bad({ script: GOOD.script.replaceAll("Hostinger", "Hostingr").replace("hostinger.com", "hostingr.com") }),
  },
  {
    name: "no-brand",
    flaw: "Never says who the ad is for",
    rule: "brand.missing",
    concept: bad({ script: GOOD.script.replace("Hostinger's AI", "our AI").replace(" at hostinger.com", " today") }),
  },
  {
    name: "competitor",
    flaw: "Names a competitor the brief rules out",
    rule: "words.avoided",
    concept: bad({ script: GOOD.script.replace("Never built a website?", "Done with Shopify?") }),
  },
  {
    name: "cta-not-on-page",
    flaw: "Promises a free trial; the landing page's button is Choose plan",
    rule: "cta.not-on-page",
    concept: bad({ script: GOOD.script.replace("Choose plan at", "Start your free trial at"), cta: "Start your free trial" }),
  },
  {
    name: "cta-not-spoken",
    flaw: "The call to action is never said",
    rule: "cta.not-spoken",
    concept: bad({ script: GOOD.script.replace(" Choose plan at hostinger.com.", " Find out more online.") }),
  },
  {
    name: "unknown-landing-page",
    flaw: "Points at a page version that doesn't exist",
    rule: "landing.unknown",
    concept: bad({ version: "black-friday" }),
  },
];

export interface AudioCase {
  name: string;
  flaw: string;
  script: string;
  transcript: Transcript;
  /** The rule that must fail the clip, or null when the clip should pass. */
  rule: string | null;
}

/** The GOOD script as speech to text writes it back: digits for numbers, "0%" for "zero percent". */
const heard = "Never built a website? Describe what you sell, and Hostinger's AI builds your online store in seconds. Customize it with drag and drop, then sell with 0% transaction fees. Plans start from $2.49 a month. Choose plan at hostinger.com.";

export const AUDIO_CASES: AudioCase[] = [
  { name: "clean", flaw: "None: the clip matches the script", script: GOOD.script, transcript: { text: heard, audio_duration_secs: 16.4 }, rule: null },
  { name: "misread-price", flaw: "The price comes out as $2.94", script: GOOD.script, transcript: { text: heard.replace("$2.49", "$2.94"), audio_duration_secs: 16.4 }, rule: "audio.number-misread" },
  { name: "price-as-two-numbers", flaw: "\"Two forty-nine\" with no dollars, which listeners can't place", script: GOOD.script, transcript: { text: heard.replace("$2.49", "two forty-nine"), audio_duration_secs: 16.4 }, rule: "audio.number-misread" },
  { name: "mispronounced-brand", flaw: "The voice says the brand like \"Hosting her\"", script: GOOD.script, transcript: { text: heard.replace("Hostinger's", "Hosting her's"), audio_duration_secs: 16.4 }, rule: "audio.brand-misread" },
  {
    name: "symbol-read-aloud",
    flaw: "\"/mo\" read as \"slash mo\"",
    script: GOOD.script.replace("$2.49 a month", "$2.49/mo"),
    transcript: { text: heard.replace("$2.49 a month", "$2.49 slash mo"), audio_duration_secs: 16.4 },
    rule: "audio.symbol-read",
  },
  { name: "runs-long", flaw: "A slow read that runs 23 seconds", script: GOOD.script, transcript: { text: heard, audio_duration_secs: 23.1 }, rule: "audio.too-long" },
  {
    name: "dropped-sentence",
    flaw: "A whole sentence is missing from the clip",
    script: GOOD.script,
    transcript: { text: heard.replace(" Customize it with drag and drop, then sell with 0% transaction fees.", ""), audio_duration_secs: 13.2 },
    rule: "audio.words-changed",
  },
];
