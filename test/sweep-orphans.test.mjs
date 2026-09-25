// node --test — see package.json's "test:sweep".
//
// Builds a scratch DB (via scripts/lib/migrations.mjs, the same engine
// test/global-setup.ts uses for vitest) and a throwaway storage tree per
// test, so this never touches the real storage/ or storage/grader.db.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { migrate } from "../scripts/lib/migrations.mjs";
import { findOrphans, deleteOrphans } from "../scripts/sweep-orphans.mjs";

const run = promisify(execFile);
const REPO_ROOT = path.join(import.meta.dirname, "..");
const DRIZZLE_DIR = path.join(REPO_ROOT, "drizzle");

/** A scratch DB + storage/{submissions,thumbnails,review} tree, cleaned up by the caller. */
function makeScratch() {
  const root = mkdtempSync(path.join(tmpdir(), "sweep-orphans-"));
  const dbPath = path.join(root, "test.db");
  migrate(dbPath, { drizzleDir: DRIZZLE_DIR });

  const submissionsDir = path.join(root, "storage", "submissions");
  const thumbnailsDir = path.join(root, "storage", "thumbnails");
  const reviewDir = path.join(root, "storage", "review");
  for (const d of [submissionsDir, thumbnailsDir, reviewDir]) mkdirSync(d, { recursive: true });

  const db = new Database(dbPath);
  const { id: courseId } = db
    .prepare("INSERT INTO courses (name, code, year, term) VALUES ('Lighting', 'ART 101', 2026, 'fall') RETURNING id")
    .get();
  const { id: assignmentId } = db
    .prepare("INSERT INTO assignments (course_id, name, points_possible) VALUES (?, 'Studio', 50) RETURNING id")
    .get(courseId);
  const { id: studentId } = db
    .prepare("INSERT INTO students (name, sort_name) VALUES ('Lovelace, Ada', 'Lovelace, Ada') RETURNING id")
    .get();

  db.close();
  return { root, dbPath, submissionsDir, thumbnailsDir, reviewDir, assignmentId, studentId };
}

/** Writes a file dated two hours ago, past the sweep's in-progress grace period. */
function writeOldFile(file, contents) {
  writeFileSync(file, contents);
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  utimesSync(file, twoHoursAgo, twoHoursAgo);
}

function insertSubmission(dbPath, { assignmentId, studentId, filePath, fileName = "a.png", mediaType = "image" }) {
  const db = new Database(dbPath);
  const row = db
    .prepare(
      "INSERT INTO submissions (assignment_id, student_id, file_path, file_name, file_type, media_type) VALUES (?, ?, ?, ?, 'image/png', ?) RETURNING id",
    )
    .get(assignmentId, studentId, filePath, fileName, mediaType);
  db.close();
  return row.id;
}

function insertMedia(dbPath, { submissionId, mediaPath, variant = "proxy" }) {
  const db = new Database(dbPath);
  db.prepare("INSERT INTO review_media (submission_id, variant, path, mime) VALUES (?, ?, ?, 'video/mp4')").run(
    submissionId,
    variant,
    mediaPath,
  );
  db.close();
}

test("findOrphans: ignores files referenced by submissions/review_media, flags everything else", () => {
  const s = makeScratch();
  try {
    // A known single-file submission.
    const knownFile = path.join(s.submissionsDir, "known.png");
    writeFileSync(knownFile, "known");
    const subId = insertSubmission(s.dbPath, {
      assignmentId: s.assignmentId,
      studentId: s.studentId,
      filePath: path.relative(s.root, knownFile),
    });

    // Its derivative, referenced by a review_media row.
    const derivative = path.join(s.reviewDir, "proxy.mp4");
    writeFileSync(derivative, "proxy bytes");
    insertMedia(s.dbPath, { submissionId: subId, mediaPath: path.relative(s.root, derivative) });

    // A sequence submission: filePath names a *directory*, whose frames have
    // no row of their own.
    const seqDir = path.join(s.submissionsDir, "sequence_123");
    mkdirSync(seqDir, { recursive: true });
    writeFileSync(path.join(seqDir, "frame_0001.exr"), "frame1");
    writeFileSync(path.join(seqDir, "frame_0002.exr"), "frame2");
    insertSubmission(s.dbPath, {
      assignmentId: s.assignmentId,
      studentId: s.studentId,
      filePath: path.relative(s.root, seqDir),
      fileName: "sequence_123",
    });

    // Genuine orphans: nothing in the DB points at these.
    const orphanFile1 = path.join(s.submissionsDir, "orphan.png");
    writeOldFile(orphanFile1, "orphan");
    const orphanFile2 = path.join(s.reviewDir, "stale_proxy.mp4");
    writeOldFile(orphanFile2, "stale");

    // A dangling row: review_media points at a file that isn't there.
    insertMedia(s.dbPath, { submissionId: subId, mediaPath: "storage/review/missing.mp4", variant: "poster" });

    const { orphanFiles, danglingRows } = findOrphans({
      dbPath: s.dbPath,
      storageDirs: [s.submissionsDir, s.thumbnailsDir, s.reviewDir],
      root: s.root,
    });

    const orphanRels = orphanFiles.map((f) => f.rel).sort();
    assert.deepEqual(orphanRels, [
      path.relative(s.root, orphanFile2),
      path.relative(s.root, orphanFile1),
    ].sort());

    assert.equal(danglingRows.length, 1);
    assert.equal(danglingRows[0].table, "review_media");
    assert.equal(danglingRows[0].path, "storage/review/missing.mp4");
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("findOrphans: never reports a file younger than an hour (upload or ingest still in progress)", () => {
  const s = makeScratch();
  try {
    const fresh = path.join(s.reviewDir, "s9.proxy.mp4");
    writeFileSync(fresh, "being written");
    const old = path.join(s.reviewDir, "s8.proxy.mp4");
    writeOldFile(old, "abandoned");

    const { orphanFiles } = findOrphans({
      dbPath: s.dbPath,
      storageDirs: [s.submissionsDir, s.thumbnailsDir, s.reviewDir],
      root: s.root,
    });
    assert.deepEqual(orphanFiles.map((f) => f.rel), [path.relative(s.root, old)]);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("deleteOrphans: removes only the listed files inside the storage root, never DB rows", () => {
  const s = makeScratch();
  try {
    const orphanFile = path.join(s.submissionsDir, "orphan.png");
    writeFileSync(orphanFile, "orphan");
    const outsider = path.join(s.root, "not-storage.png");
    writeFileSync(outsider, "should never be touched");

    const storageDirs = [s.submissionsDir, s.thumbnailsDir, s.reviewDir];
    const fakeList = [
      { abs: orphanFile, rel: path.relative(s.root, orphanFile), size: 6 },
      // Same basename, but resolves outside every storage dir — must be refused.
      { abs: outsider, rel: path.relative(s.root, outsider), size: 100 },
    ];

    const { removed, freed } = deleteOrphans(fakeList, { storageDirs });

    assert.equal(removed, 1);
    assert.equal(freed, 6);
    assert.equal(existsSync(orphanFile), false);
    assert.equal(existsSync(outsider), true, "a path outside the storage root must never be deleted");
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("CLI: dry run by default, --delete requires --yes, --delete --yes removes only orphans", async () => {
  const s = makeScratch();
  try {
    const orphanFile = path.join(s.submissionsDir, "orphan.png");
    writeOldFile(orphanFile, "orphan-bytes");
    const knownFile = path.join(s.submissionsDir, "known.png");
    writeFileSync(knownFile, "known");
    insertSubmission(s.dbPath, {
      assignmentId: s.assignmentId,
      studentId: s.studentId,
      filePath: path.relative(s.root, knownFile),
    });

    const scriptPath = path.join(REPO_ROOT, "scripts", "sweep-orphans.mjs");
    const env = { ...process.env, DB_PATH: s.dbPath };

    // Default: dry run, nothing deleted.
    const dry = await run("node", [scriptPath], { cwd: s.root, env });
    assert.match(dry.stdout, /Dry run/);
    assert.equal(existsSync(orphanFile), true);

    // --delete alone refuses.
    await assert.rejects(run("node", [scriptPath, "--delete"], { cwd: s.root, env }));
    assert.equal(existsSync(orphanFile), true);

    // --delete --yes actually removes the orphan, leaves the known file.
    const del = await run("node", [scriptPath, "--delete", "--yes"], { cwd: s.root, env });
    assert.match(del.stdout, /Deleted 1 file/);
    assert.equal(existsSync(orphanFile), false);
    assert.equal(existsSync(knownFile), true);

    // No DB rows were touched.
    const db = new Database(s.dbPath);
    const count = db.prepare("SELECT COUNT(*) AS n FROM submissions").get().n;
    db.close();
    assert.equal(count, 1);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});
