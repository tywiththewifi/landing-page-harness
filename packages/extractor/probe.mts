import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: process.env.LPH_CHROMIUM_PATH });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(process.argv[2], { waitUntil: "load", timeout: 45000 }).catch(e => console.log("goto", e.message));
await p.waitForTimeout(2500);
await p.screenshot({ path: process.argv[3] });
console.log(await p.evaluate(process.argv[4]));
await b.close();
