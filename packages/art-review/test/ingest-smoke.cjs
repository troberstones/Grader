/**
 * Smoke test for the ingest pipeline against real files.
 * Run: node test/ingest-smoke.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const { ingestFile, probe, classify } = require("./.srv/server/ingest.js");

const GRADER = "/Users/chrisharvey/Documents/Dev/grader";
const OUT = path.join(__dirname, ".out");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

function mb(p) {
  try {
    return (fs.statSync(p).size / 1024 / 1024).toFixed(2) + " MB";
  } catch {
    return "missing";
  }
}

async function main() {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error("usage: node test/ingest-smoke.cjs <file> [file...]");
    process.exit(1);
  }

  for (const rel of targets) {
    const input = path.isAbsolute(rel) ? rel : path.join(GRADER, rel);
    const name = path.basename(input);
    console.log(`\n─── ${name}  (${mb(input)}, kind=${classify(name)}) ───`);

    const t0 = Date.now();
    try {
      if (classify(name) === "video") {
        const info = await probe(input);
        console.log("  probe:", {
          size: `${info.width}x${info.height}`,
          fps: info.fps.toFixed(3),
          frames: info.frameCount,
          duration: info.duration.toFixed(2) + "s",
          codec: info.codec,
          audio: info.hasAudio,
          primaries: info.colorPrimaries,
        });
      }

      const result = await ingestFile(input, name, {
        outDir: OUT,
        baseName: name.replace(/\W+/g, "_"),
        maxWidth: 1920,
        allIntra: true,
        force: true,
      });

      console.log(`  kind=${result.kind}  ${result.width}x${result.height}  frames=${result.frameCount}  fps=${result.fps}`);
      for (const d of result.derivatives) {
        console.log(`   · ${d.variant.padEnd(10)} ${mb(d.path).padStart(9)}  ${path.basename(d.path)}`);
      }
      if (result.warnings.length) console.log("  warnings:", result.warnings);
      console.log(`  took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      console.log("  FAILED:", e.message);
    }
  }
}

main();
