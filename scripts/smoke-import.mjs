// Imports real sites through a deployed import service, the way the demo does.
//   node scripts/smoke-import.mjs <service url> <site url>...
const [service, ...sites] = process.argv.slice(2);
if (!service || !sites.length) {
  console.error("Usage: node scripts/smoke-import.mjs <service url> <site url>...");
  process.exit(2);
}

const call = async (path, body) => {
  const res = await fetch(`${service}${path}`, body && { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
};

let failed = false;
const fail = (message) => {
  console.log(`  ✗ ${message}`);
  failed = true;
};

// A cold start can take a while, so the first call gets a few tries.
for (let i = 0; ; i++) {
  const health = await call("/api/health").catch((err) => ({ status: 0, data: String(err) }));
  if (health.status === 200) break;
  if (i === 5) throw new Error(`Health check failed: ${health.status} ${JSON.stringify(health.data)}`);
  await new Promise((r) => setTimeout(r, 10_000));
}
console.log(`${service} is up`);

const refused = await call("/api/brands", { url: "http://169.254.169.254/latest/meta-data/" });
if (refused.status === 400) console.log(`  ✓ internal address refused: ${refused.data?.error}`);
else fail(`internal address answered ${refused.status}`);

for (const site of sites) {
  console.log(`Importing ${site}`);
  const started = Date.now();
  const { status, data } = await call("/api/brands", { url: site });
  if (status !== 202) {
    fail(`start answered ${status}: ${JSON.stringify(data)}`);
    continue;
  }
  let job = data;
  let step = "";
  while (job.status === "running" && Date.now() - started < 180_000) {
    if (job.step !== step) console.log(`  … ${(step = job.step)}`);
    await new Promise((r) => setTimeout(r, 2000));
    job = (await call(`/api/jobs/${data.id}`)).data;
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  if (job.status !== "done" || !job.brand) {
    fail(`${job.status} after ${seconds}s: ${job.error ?? "no brand"}`);
    continue;
  }
  const { brand } = job;
  console.log(`  ✓ ${brand.name} in ${seconds}s: ${brand.colors.length} colours, fonts ${brand.fonts.heading} and ${brand.fonts.body}, pages ${brand.pages.join(" ")}`);
  if ((await call(`/api/jobs/${data.id}`)).status !== 404) fail("the finished job wasn't forgotten");
}

process.exit(failed ? 1 : 0);
