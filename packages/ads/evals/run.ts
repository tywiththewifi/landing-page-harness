// Prints the eval table as Markdown (CI adds it to the job summary) and fails if any case misbehaves.
import { HOSTINGER, loadInputs } from "../src/demo.ts";
import { evalsMarkdown, runEvals } from "./index.ts";

const rows = runEvals(await loadInputs(HOSTINGER));
console.log(evalsMarkdown(rows));
if (rows.some((r) => !r.ok)) process.exit(1);
