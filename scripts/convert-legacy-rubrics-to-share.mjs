#!/usr/bin/env node
/**
 * Converts every rubric authored by the archived v1/v2/v3 editors into the
 * share model, so the app can drop the points-based editors and grading views
 * (src/components/rubric/_archive/) without stranding anything.
 *
 * **The conversion preserves each recorded grade's exact percentage.** A
 * criterion's point maximum becomes its share, and its level points become the
 * rubric's band edges — the same arithmetic, rearranged. Nothing is
 * recalibrated. If a rubric should move to the Advanced or Foundation preset,
 * that is a decision to make afterwards in the editor, where the outcome table
 * shows what it does to every band before it is applied to anyone.
 *
 * What it writes, per rubric:
 *   - rubrics.settings      → {"model":"share","bandEdges":[...],"convertedFrom":"v1|v3"}
 *   - rubric_criteria.weight → the criterion's point maximum, read as "share"
 *
 * What it deliberately does NOT touch:
 *   - rubric_levels.points — left in place, which is what makes this
 *     reversible: clearing settings.model restores the old rubric exactly.
 *   - grades.total_score — no student's recorded number is rewritten. A grade
 *     re-saved later recomputes with rounding applied once at the end rather
 *     than per criterion, which can move a stored total by a few tenths; the
 *     verification pass below reports exactly where that would happen.
 *
 * Reports and changes nothing by default. Pass --apply to write.
 *
 *   node scripts/convert-legacy-rubrics-to-share.mjs
 *   node scripts/convert-legacy-rubrics-to-share.mjs --apply
 *
 * Idempotent: a rubric already carrying settings.model === "share" is skipped.
 */
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APPLY = process.argv.includes("--apply");
const dbPath = process.env.DB_PATH || "storage/grader.db";

/**
 * --floor=advanced|foundation forces a calibration onto rubrics that cannot be
 * converted faithfully (in practice, one with a 0-point bottom level, which
 * the share model has no way to express). It is opt-in because it MOVES the
 * grades already recorded against those rubrics — every one is reported.
 * Rubrics that convert exactly ignore it.
 */
const floorArg = process.argv.find((a) => a.startsWith("--floor"));
const floorName = floorArg?.includes("=") ? floorArg.split("=")[1] : floorArg ? process.argv[process.argv.indexOf(floorArg) + 1] : null;

/**
 * The conversion arithmetic is `src/lib/rubric/legacy.ts`, and it is used from
 * here rather than reimplemented — this script must agree with the app and the
 * test suite exactly, since it is rewriting grade-bearing data.
 *
 * Those modules import each other without file extensions, which Node's ESM
 * resolver will not follow, so they are compiled to CommonJS in a temp
 * directory the same way scripts/build-rubric-test.sh does it for the tests.
 * Nothing is left behind.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src", "lib", "rubric");
const buildDir = mkdtempSync(path.join(tmpdir(), "grader-rubric-"));
let convertLegacyRubric, computeScore, validateRubric, BAND_PRESETS;
try {
  execFileSync(
    "npx",
    [
      "tsc",
      ...readdirSync(srcDir).filter((f) => f.endsWith(".ts")).map((f) => path.join(srcDir, f)),
      "--rootDir", srcDir,
      "--outDir", buildDir,
      "--module", "commonjs",
      "--moduleResolution", "node",
      "--target", "es2022",
      "--skipLibCheck",
      "--esModuleInterop",
      "--strict",
    ],
    { cwd: root, stdio: "inherit" },
  );
  const require = createRequire(import.meta.url);
  ({ convertLegacyRubric } = require(path.join(buildDir, "legacy.js")));
  ({ computeScore } = require(path.join(buildDir, "score.js")));
  ({ validateRubric } = require(path.join(buildDir, "validate.js")));
  ({ BAND_PRESETS } = require(path.join(buildDir, "bands.js")));
} finally {
  rmSync(buildDir, { recursive: true, force: true });
}

if (floorName && !BAND_PRESETS[floorName]) {
  console.error(`--floor must be one of: ${Object.keys(BAND_PRESETS).join(", ")}`);
  process.exit(1);
}
const forcedEdges = floorName ? BAND_PRESETS[floorName] : undefined;

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const rubrics = db.prepare("SELECT id, name, settings FROM rubrics ORDER BY id").all();

const criteriaOf = db.prepare(
  "SELECT id, name, description, weight, archived FROM rubric_criteria WHERE rubric_id = ? ORDER BY sort_order, id",
);
const levelsOf = db.prepare(
  "SELECT id, level, label, description, points FROM rubric_levels WHERE criteria_id = ? ORDER BY level",
);
const assignmentsOf = db.prepare("SELECT id, name, points_possible FROM assignments WHERE rubric_id = ?");
const gradesOf = db.prepare("SELECT id, student_id, total_score, status FROM grades WHERE assignment_id = ?");
const entriesOf = db.prepare("SELECT criteria_id, level_id, nudge FROM grade_entries WHERE grade_id = ?");

const setSettings = db.prepare("UPDATE rubrics SET settings = ?, updated_at = datetime('now') WHERE id = ?");
const setShare = db.prepare("UPDATE rubric_criteria SET weight = ? WHERE id = ?");

let converted = 0;
let skipped = 0;
let refused = 0;
let inexact = 0;
let forced = 0;
const roundingNotes = [];
const movedNotes = [];

for (const row of rubrics) {
  const settings = row.settings ? JSON.parse(row.settings) : null;
  if (settings?.model === "share") {
    skipped += 1;
    continue;
  }

  const criteria = criteriaOf.all(row.id);
  const live = criteria.filter((c) => !c.archived);
  const legacy = {
    name: row.name,
    description: null,
    settings,
    criteria: live.map((c) => ({
      name: c.name,
      description: c.description,
      weight: c.weight,
      levels: levelsOf.all(c.id).map((l) => ({
        level: l.level,
        label: l.label,
        description: l.description,
        points: l.points,
      })),
    })),
  };

  let result = convertLegacyRubric(legacy);
  if (!result.ok && forcedEdges) {
    // Only after the faithful attempt has failed, so a rubric that converts
    // exactly is never moved by the presence of this flag.
    result = convertLegacyRubric(legacy, { bandEdges: forcedEdges });
  }

  console.log(`\n── #${row.id} ${row.name}`);
  if (criteria.length !== live.length) {
    console.log(`   ${criteria.length - live.length} archived criterion/criteria ignored (they keep their grade history either way).`);
  }

  if (!result.ok) {
    refused += 1;
    console.log("   REFUSED — not converted:");
    for (const e of result.errors) console.log(`     • ${e.where}: ${e.message}`);
    if (!forcedEdges) {
      console.log(`     Re-run with --floor=advanced or --floor=foundation to convert it onto a chosen`);
      console.log(`     calibration instead. That changes the grades already recorded against it, and`);
      console.log(`     every change is listed before anything is written.`);
    }
    continue;
  }

  const family = result.rubric.bandEdges.map((e) => `${Math.round(e * 100)}%`).join(" / ");
  console.log(`   bands ${family} / 100%   shares ${result.rubric.criteria.map((c) => c.share).join(", ")}`);
  if (!result.exact) inexact += 1;
  if (forcedEdges && !result.errors.length && result.warnings.some((w) => w.where === "the rubric" && w.message.includes("calibration"))) forced += 1;
  for (const w of result.warnings) console.log(`     • ${w.where}: ${w.message}`);

  // ── Verification: what every existing grade would now compute to. ────────
  const normal = validateRubric(result.rubric).rubric;
  if (normal) {
    const byCriterionId = new Map(live.map((c, i) => [c.id, i]));
    const levelOfId = new Map();
    for (const c of live) for (const l of levelsOf.all(c.id)) levelOfId.set(l.id, l.level);

    for (const assignment of assignmentsOf.all(row.id)) {
      for (const grade of gradesOf.all(assignment.id)) {
        if (grade.status === "missing" || grade.total_score === null) continue;
        const selections = [];
        for (const entry of entriesOf.all(grade.id)) {
          const criterionIndex = byCriterionId.get(entry.criteria_id);
          const level = levelOfId.get(entry.level_id);
          if (criterionIndex === undefined || level === undefined) continue;
          selections.push({ criterionIndex, level, nudge: entry.nudge === -1 || entry.nudge === 1 ? entry.nudge : 0 });
        }
        if (!selections.length) continue;
        const now = computeScore(normal, selections, assignment.points_possible).points;
        const drift = Math.round((now - grade.total_score) * 10) / 10;
        if (drift !== 0) {
          (result.exact ? roundingNotes : movedNotes).push(
            `#${row.id} ${row.name} → ${assignment.name}, student ${grade.student_id}: stored ${grade.total_score}, recomputes to ${now} (${drift > 0 ? "+" : ""}${drift})`,
          );
        }
      }
    }
  }

  if (APPLY) {
    const next = JSON.stringify({
      model: "share",
      bandEdges: result.rubric.bandEdges,
      convertedFrom: settings?.gradingMode === "v3" ? "v3" : "v1",
    });
    db.transaction(() => {
      setSettings.run(next, row.id);
      live.forEach((c, i) => setShare.run(result.rubric.criteria[i].share, c.id));
    })();
    console.log("   converted.");
  }
  converted += 1;
}

console.log(`\n${"─".repeat(60)}`);
console.log(`${converted} to convert, ${skipped} already on the share model, ${refused} refused.`);
if (inexact - forced > 0) {
  console.log(`${inexact - forced} used more than one point family, so cannot be represented exactly — see the notes above.`);
}
if (forced) {
  console.log(`${forced} could not be converted faithfully and took the --floor=${floorName} calibration instead.`);
}
if (movedNotes.length) {
  console.log(`\n!! ${movedNotes.length} recorded grade(s) CHANGE, because their rubric could not be`);
  console.log(`converted faithfully and was given a different calibration:`);
  for (const note of movedNotes.slice(0, 20)) console.log(`  • ${note}`);
  if (movedNotes.length > 20) console.log(`  … and ${movedNotes.length - 20} more.`);
  console.log(`Stored totals are still not rewritten — each moves only when that grade is saved again.`);
}
if (roundingNotes.length) {
  console.log(`\n${roundingNotes.length} recorded total(s) would recompute slightly differently, because the share`);
  console.log(`model rounds once at the end rather than per criterion. Stored totals are NOT rewritten;`);
  console.log(`each changes only if that grade is saved again:`);
  for (const note of roundingNotes.slice(0, 20)) console.log(`  • ${note}`);
  if (roundingNotes.length > 20) console.log(`  … and ${roundingNotes.length - 20} more.`);
} else if (!movedNotes.length) {
  console.log("Every recorded total recomputes to exactly what is stored.");
}

if (!APPLY) {
  console.log("\nNothing was written. Re-run with --apply to convert.");
  console.log("Back up first: npm run db:backup");
}

db.close();
