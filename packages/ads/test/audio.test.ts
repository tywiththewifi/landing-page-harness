import { describe, expect, it } from "vitest";
import { AUDIO_CASES } from "../evals/cases.ts";
import { align, checkAudio, differences } from "../src/audio-check.ts";
import { digitize, speechTokens, wordsToNumbers } from "../src/spoken.ts";

const slot = { min: 15, max: 20 };

describe("audio evals: each bad clip fails for its flaw", () => {
  it.each(AUDIO_CASES)("$name: $flaw", ({ script, transcript, rule }) => {
    const r = checkAudio(script, transcript, { brandName: "Hostinger", seconds: slot });
    if (rule === null) {
      expect(r.issues).toEqual([]);
      expect(r.pass).toBe(true);
    } else {
      expect(r.pass).toBe(false);
      expect(r.issues.filter((i) => i.severity === "error").map((i) => i.rule)).toContain(rule);
    }
  });

  it("says what was heard instead", () => {
    const r = checkAudio("Plans start from $2.49 a month at Hostinger.", { text: "Plans start from $2.94 a month at Hostinger." }, { brandName: "Hostinger", seconds: { min: 0, max: 20 } });
    expect(r.issues[0]?.message).toContain('the voice said "2.94"');
  });

  it("measures length from the last word when the clip length isn't given", () => {
    const words = [{ text: "Hostinger", start: 0, end: 21.5, type: "word" }];
    const r = checkAudio("Hostinger", { text: "Hostinger", words }, { brandName: "Hostinger", seconds: slot });
    expect(r.seconds).toBe(21.5);
    expect(r.issues.map((i) => i.rule)).toContain("audio.too-long");
  });
});

describe("spoken text", () => {
  it("reads number words as digits", () => {
    expect(wordsToNumbers("one hundred and fifty")).toEqual([150]);
    expect(wordsToNumbers("two forty-nine")).toEqual([2, 49]);
    expect(wordsToNumbers("two thousand and five")).toEqual([2005]);
    expect(digitize("two dollars and forty-nine cents")).toBe("$2.49");
    expect(digitize("eighty-five percent")).toBe("85%");
    expect(digitize("3 million sellers")).toBe("3000000 sellers");
    expect(digitize("two and three")).toBe("2 and 3");
  });

  it("makes a script and its transcript comparable", () => {
    expect(speechTokens("Sell with 0% fees at Hostinger.com, 1,000+ apps")).toEqual(["sell", "with", "0", "percent", "fees", "at", "hostinger", "dot", "com", "1000", "plus", "apps"]);
    expect(speechTokens("zero percent fees at hostinger dot com")).toEqual(["zero", "percent", "fees", "at", "hostinger", "dot", "com"].map((w) => (w === "zero" ? "0" : w)));
  });

  it("aligns words and groups the changes", () => {
    const ops = align(["from", "2.49", "a", "month"], ["from", "2.94", "a", "month"]);
    expect(differences(ops)).toEqual([{ expected: "2.49", heard: "2.94" }]);
  });
});

describe("speakable", () => {
  it("spells out prices and percentages for the voice", async () => {
    const { speakable, numberToWords } = await import("../src/spoken.ts");
    expect(speakable("From $2.49 a month, with 0% fees and 85% of issues solved.")).toBe(
      "From two dollars and forty-nine cents a month, with zero percent fees and eighty-five percent of issues solved.",
    );
    expect(speakable("Just $1 or $10.00")).toBe("Just one dollar or ten dollars");
    expect(numberToWords(1249)).toBe("one thousand two hundred forty-nine");
  });

  it("reads back as the same numbers, so the clip is still checked against the approved script", async () => {
    const { speakable } = await import("../src/spoken.ts");
    const script = "Plans start from $2.49 a month at Hostinger, with 0% fees.";
    expect(speechTokens(speakable(script))).toEqual(speechTokens(script));
  });
});
