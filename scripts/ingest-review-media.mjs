#!/usr/bin/env node
/**
 * Warm review derivatives so the first open of a student is instant.
 *
 * Requires the dev/prod server to be running — it drives the ingest route so
 * the TypeScript pipeline is reused rather than duplicated here.
 *
 * The route requires a signed-in instructor with edit rights on the
 * assignment's course, so pass your session cookie's value (browser dev
 * tools → Application → Cookies → grader_session):
 *
 *   GRADER_SESSION=<token> npm run review:ingest -- 22
 *   BASE=https://grader.example.edu GRADER_SESSION=<token> npm run review:ingest -- 22
 */

const base = process.env.BASE || "http://localhost:3000";
const session = process.env.GRADER_SESSION;
const assignmentId = Number(process.argv[2]);

if (!assignmentId || !session) {
  console.error("Usage: GRADER_SESSION=<token> npm run review:ingest -- <assignmentId>");
  process.exit(1);
}

console.log(`Ingesting assignment ${assignmentId} via ${base} …`);
console.log("(video transcodes run sequentially; this can take a while)");

const started = Date.now();

try {
  const res = await fetch(`${base}/api/review/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `grader_session=${session}` },
    body: JSON.stringify({ assignmentId }),
  });

  if (!res.ok) {
    console.error(`Server returned ${res.status}.${res.status === 401 || res.status === 403 ? " Is GRADER_SESSION current and allowed to edit this course?" : " Is the server running?"}`);
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
