#!/usr/bin/env node
/**
 * Warm review derivatives so the first open of a student is instant.
 *
 * Requires the dev/prod server to be running — it drives the ingest route so
 * the TypeScript pipeline is reused rather than duplicated here.
 *
 *   npm run review:ingest              # everything
 *   npm run review:ingest -- 22        # assignment 22 only
 *   BASE=http://localhost:3001 npm run review:ingest
 */

const base = process.env.BASE || "http://localhost:3000";
const assignmentId = process.argv[2] ? Number(process.argv[2]) : undefined;

const label = assignmentId ? `assignment ${assignmentId}` : "every submission";
console.log(`Ingesting ${label} via ${base} …`);
console.log("(video transcodes run sequentially; this can take a while)");

const started = Date.now();

try {
  const res = await fetch(`${base}/api/review/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(assignmentId ? { assignmentId } : {}),
  });

  if (!res.ok) {
    console.error(`Server returned ${res.status}. Is the dev server running?`);
    process.exit(1);
  }

  const data = await res.json();
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${data.ok}/${data.total} ready in ${secs}s`);

  if (data.failed?.length) {
    console.log(`\n${data.failed.length} failed:`);
    for (const f of data.failed) console.log(`  · ${f.file}: ${f.error}`);
  }
} catch (e) {
  console.error(`Could not reach ${base} — start the server first (npm run dev).`);
  console.error(e.message);
  process.exit(1);
}
