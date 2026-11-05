/**
 * Text as it sounds. A script says "$2.49" and a transcript may say "$2.49" or "two
 * dollars and forty-nine cents"; a script says "zero percent" and the site says "0%".
 * Everything here turns both into the same digits so they can be compared.
 */

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { hundred: 100, thousand: 1_000, million: 1_000_000, billion: 1_000_000_000 };

const NUMBER_WORD = [...Object.keys(UNITS), ...Object.keys(TENS), ...Object.keys(SCALES)].join("|");
// A run of number words: "forty-nine", "one hundred and fifty", "two thousand". "and" only joins inside a run.
const RUN = new RegExp(`\\b(?:${NUMBER_WORD})(?:(?:(?<=hundred|thousand|million|billion)\\s+and\\s+|[\\s-]+)(?:${NUMBER_WORD}))*\\b`, "gi");

/**
 * "one hundred and fifty" → [150]. Words that can't join into one number start a new
 * one, so "two forty-nine" → [2, 49]. Null if a word isn't a number word.
 */
export function wordsToNumbers(words: string): number[] | null {
  const out: number[] = [];
  let total = 0;
  let current = 0;
  let seen = false;
  const flush = () => {
    if (seen) out.push(total + current);
    total = current = 0;
    seen = false;
  };
  for (const w of words.toLowerCase().split(/[\s-]+/).filter((x) => x && x !== "and")) {
    if (w in UNITS) {
      const lastTwo = current % 100;
      if (seen && (lastTwo % 10 !== 0 || (lastTwo > 0 && lastTwo < 20) || (current === 0 && total === 0))) flush();
      current += UNITS[w]!;
    } else if (w in TENS) {
      if (seen && current % 100 !== 0) flush();
      else if (seen && current === 0 && total === 0) flush();
      current += TENS[w]!;
    } else if (w === "hundred") current = (current || 1) * 100;
    else if (w in SCALES) {
      total += (current || 1) * SCALES[w]!;
      current = 0;
    } else return null;
    seen = true;
  }
  flush();
  return out;
}

/**
 * Rewrites spoken numbers as digits: "forty-nine" → "49", "zero percent" → "0%",
 * "two dollars and forty-nine cents" → "$2.49", "1,000" → "1000". Other text is kept.
 */
export function digitize(text: string): string {
  return text
    .replace(/\b(\d+(?:\.\d+)?)\s+(thousand|million|billion)\b/gi, (_m, n: string, scale: string) => String(Math.round(Number(n) * SCALES[scale.toLowerCase()]!)))
    .replace(RUN, (run) => {
      const ns = wordsToNumbers(run);
      return ns?.length ? ns.join(" ") : run;
    })
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/\b(\d+)\s+dollars?(?:\s+(?:and\s+)?(\d{1,2})\s+cents?)?/gi, (_m, d: string, c?: string) => `$${d}${c ? `.${c.padStart(2, "0")}` : ""}`)
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:percent|per\s+cent)\b/gi, "$1%");
}

/**
 * Words for comparing a script with a transcript: lowercase, numbers as digits,
 * punctuation gone, "%" read as "percent" and "+" as "plus", possessives dropped.
 */
export function speechTokens(text: string): string[] {
  const out: string[] = [];
  const raw = digitize(text.replace(/[’‘]/g, "'"))
    // Web addresses are read "hostinger dot com", whichever way they're written.
    .replace(/\b([\p{L}\p{N}-]+)\.(com|net|org|io|co|store|ai|app|dev)\b/giu, "$1 dot $2")
    .toLowerCase()
    .replace(/'s\b/g, "")
    .split(/[^\p{L}\p{N}.%$+']+/u);
  for (let t of raw) {
    t = t.replace(/^[.']+|[.']+$/g, "");
    if (!t) continue;
    const m = t.match(/^\$?(\d+(?:\.\d+)?)(%|\+)?$/);
    if (m) {
      out.push(m[1]!);
      if (m[2] === "%") out.push("percent");
      if (m[2] === "+") out.push("plus");
      continue;
    }
    for (const part of t.split(/[%$+]/)) if (part) out.push(part.replace(/\./g, ""));
  }
  return out.filter(Boolean);
}

export const isNumberToken = (t: string) => /^\d+(?:\.\d+)?$/.test(t);

const ONES = Object.keys(UNITS);
const TEN_WORDS = Object.keys(TENS);

/** 249 → "two hundred forty-nine". Whole numbers below a billion. */
export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1_000_000_000) return String(n);
  if (n < 20) return ONES[n]!;
  if (n < 100) return `${TEN_WORDS[Math.floor(n / 10) - 2]}${n % 10 ? `-${ONES[n % 10]}` : ""}`;
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberToWords(n % 100)}` : ""}`;
  for (const [scale, size] of [["million", 1_000_000], ["thousand", 1_000]] as const) {
    if (n >= size) return `${numberToWords(Math.floor(n / size))} ${scale}${n % size ? ` ${numberToWords(n % size)}` : ""}`;
  }
  return String(n);
}

/**
 * The script as the voice should read it: prices and percentages written out in
 * words, so "$2.49" can't come out as "two point forty-nine". The approved script
 * doesn't change; the audio check still compares the clip with it.
 */
export function speakable(script: string): string {
  return script
    .replace(/\$(\d{1,9})\.(\d{2})\b/g, (_m, d: string, c: string) => {
      const dollars = Number(d);
      const cents = Number(c);
      const dw = `${numberToWords(dollars)} ${dollars === 1 ? "dollar" : "dollars"}`;
      return cents ? `${dw} and ${numberToWords(cents)} ${cents === 1 ? "cent" : "cents"}` : dw;
    })
    .replace(/\$(\d{1,9})\b/g, (_m, d: string) => `${numberToWords(Number(d))} ${d === "1" ? "dollar" : "dollars"}`)
    .replace(/\b(\d{1,9})%/g, (_m, d: string) => `${numberToWords(Number(d))} percent`);
}
