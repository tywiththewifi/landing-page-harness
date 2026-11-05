# Audio ad concepts

A small demo built on Softlander's first three phases. A brand kit, a brief and a landing page go in, and voiced audio ads come out. Each ad is checked before it is voiced, and checked again after.

```bash
pnpm ads                                                    # the Hostinger demo, into runs/ads-hostinger
pnpm ads --concepts packages/ads/demo/hostinger/concepts.json   # replay the saved scripts: no model calls, and no ElevenLabs calls while the clips are cached
pnpm --filter @lph/ads evals                                # the evals: bad scripts and bad clips the checks must catch
```

Writing new scripts needs `ANTHROPIC_API_KEY`. Voicing anything that isn't already cached needs `ELEVENLABS_API_KEY`, with text to speech and speech to text allowed on the key.

## What happens

1. **Write.** Claude writes one 15 to 20 second ad per version of the landing page: the script, a headline and the call to action. It works from the site's own copy and the page's brief, under the same grounding rules as the brief and the page.
2. **Gate.** Every script is checked with plain rules before it costs anything to voice. No model is involved. Errors block the script, and a blocked script goes back to Claude once with the reasons.

   | Rule | Blocks |
   |---|---|
   | `number.unsourced` | A number that isn't on the site or in the request, whether it's written in digits or in words |
   | `claim.unsourced` | "Best", "fastest", "guaranteed", "trusted by" and similar claims, unless the site says the same words |
   | `tone.hype`, `tone.shouting` | Hype words and capitals the brand's own copy never uses |
   | `length.too-long` | A script that runs over the slot, estimated from the spoken words (so "$2.49" counts as several) |
   | `brand.missing`, `brand.misspelled` | A script that never says the brand's name, or spells it nearly right |
   | `words.avoided` | Names the brief rules out, such as competitors |
   | `cta.not-spoken`, `cta.not-on-page` | A call to action that isn't said, or doesn't match the button on the page the ad points to |
   | `landing.unknown` | A landing page version that doesn't exist |

   Warnings don't block. They cover a headline that doesn't echo the page's heading, a soft call to action at the decision stage, and symbols such as "/mo" that a voice may read aloud.
3. **Voice.** ElevenLabs text to speech reads each script that passes, using one stock voice. Each clip is cached under a hash of its text, voice, model, settings and format, so an edited script never plays stale audio. The cache is committed, which lets the demo replay without a key.
4. **Audio check.** ElevenLabs speech to text transcribes each clip, and the transcript is compared word by word with the approved script. Numbers are normalised on both sides, so "$2.49" and "two dollars and forty-nine cents" match, while "two point forty-nine" doesn't. The check catches:
   - a misread price or number;
   - the brand's name heard as something else;
   - a symbol read aloud;
   - dropped or changed words;
   - a clip that runs over the slot.

   No key terms are passed to speech to text, because hinting the brand's name would make the transcript spell it right even when the voice said it wrong.
5. **Retake.** When a clip fails on a number, the voice gets the script again with prices and percentages written out in words. The new clip is still checked against the approved script.
6. **Report.** `index.html` shows each ad with its clip, both checklists, the script set against what was heard, and a link to its landing page version. The evals are on the same page. Clips are labelled as AI-generated.

## What the first run found

On the Hostinger run, the voice read "$2.49 a month" as "two point forty-nine a month" in one of the three clips, and the audio check failed it. The second take, with the price written out, passed. The text checks couldn't have caught this, because the script itself was correct.

## Evals

`evals/cases.ts` holds 14 scripts, each broken in one specific way, and 7 transcripts that stand in for bad clips: a misread price, a mispronounced brand, a symbol read aloud, a clip that runs long, a dropped sentence and a clean one. They run in `pnpm test` and in CI, and they make no calls to Claude or ElevenLabs.

## Not included

There's no video, music, sound effects, connection to an ad platform, or learning from results. The demo data is Hostinger's public site, imported in November 2026. The concept was made for a job application, not by or for Hostinger.
