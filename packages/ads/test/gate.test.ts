import { beforeAll, describe, expect, it } from "vitest";
import { AD_BRIEF, GATE_CASES, GOOD, GOOD_SWITCHERS } from "../evals/cases.ts";
import { HOSTINGER, loadInputs, type DemoInputs } from "../src/demo.ts";
import { gateConcept, spokenWords, type GateContext } from "../src/gate.ts";
import { adBrief } from "../src/schema.ts";

let ctx: GateContext;
beforeAll(async () => {
  const { brand, brief, page }: DemoInputs = await loadInputs(HOSTINGER);
  ctx = { brand, brief, page, adBrief: adBrief.parse(AD_BRIEF) };
});

describe("gate on good scripts", () => {
  it.each([GOOD, GOOD_SWITCHERS])("passes $id with no errors or warnings", (concept) => {
    const r = gateConcept(concept, ctx);
    expect(r.issues).toEqual([]);
    expect(r.pass).toBe(true);
    expect(r.seconds).toBeGreaterThanOrEqual(15);
    expect(r.seconds).toBeLessThanOrEqual(20);
  });

  it("points each ad at the page version's buttons, not another version's", () => {
    const r = gateConcept({ ...GOOD, version: null }, ctx);
    expect(r.pass).toBe(true);
  });
});

describe("gate evals: each bad script is blocked for its flaw", () => {
  it.each(GATE_CASES)("$name: $flaw", ({ concept, rule }) => {
    const r = gateConcept(concept, ctx);
    expect(r.pass).toBe(false);
    expect(r.issues.filter((i) => i.severity === "error").map((i) => i.rule)).toContain(rule);
  });

  it("has at least ten bad scripts", () => expect(GATE_CASES.length).toBeGreaterThanOrEqual(10));
});

describe("gate details", () => {
  it("accepts a number the site states in words or digits", () => {
    const r = gateConcept({ ...GOOD, script: GOOD.script.replace("in seconds", "and 85% of issues are solved without a human") }, ctx);
    expect(r.issues.filter((i) => i.rule === "number.unsourced")).toEqual([]);
  });

  it("accepts a claim when the site says the same words", () => {
    const r = gateConcept({ ...GOOD, script: GOOD.script.replace("Never built a website?", "Join millions of happy customers.") }, ctx);
    expect(r.issues.filter((i) => i.rule === "claim.unsourced")).toEqual([]);
  });

  it("doesn't count a site's question as a claim", () => {
    // hostinger.com asks "How do I choose the best website builder?"; it never says it is the best.
    const r = gateConcept({ ...GOOD, script: GOOD.script.replace("Never built a website?", "Hostinger is the best website builder in the world.") }, ctx);
    expect(r.issues.map((i) => i.rule)).toContain("claim.unsourced");
  });

  it("warns about symbols a voice may read aloud", () => {
    const r = gateConcept({ ...GOOD, script: GOOD.script.replace("$2.49 a month", "$2.49/mo") }, ctx);
    expect(r.pass).toBe(true);
    expect(r.issues.map((i) => i.rule)).toEqual(["speech.symbols"]);
  });

  it("counts a price as several spoken words", () => {
    expect(spokenWords("From $2.49 a month")).toBe(7);
    expect(spokenWords("zero percent fees")).toBe(3);
  });
});
