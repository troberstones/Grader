// Exercises scripts/backup.mjs + scripts/restore.mjs end to end against a
// tiny fixture "app" — never storage/grader.db or the real repo. Everything
// lives under test/.tmp-backup (gitignored) and is built fresh per test.
//
//   (a) backup() -> restore(--verify) round-trips a fixture app: DB rows,
//       media files, and config all come back, and the restore report says
//       PASS.
//   (b) retention prunes only old DB-snapshot-shaped files, keeping exactly
//       BACKUP_KEEP of them.
//   (c) backup refuses to use the app directory (or "/", or "") as a
//       destination instead of silently writing into it.
//   (d) restore --into-live refuses without --yes and --confirm-service-stopped,
//       and proceeds once both are given (this dev machine has no systemctl,
//       so the "service still running" check can't block it either way —
//       see scripts/restore.mjs's isLiveServiceActive()).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import { migrate } from "../scripts/lib/migrations.mjs";
import { runBackup } from "../scripts/backup.mjs";
import { runRestore } from "../scripts/restore.mjs";
import { assertSafeDirectory, pruneDbSnapshots, listDbSnapshots, DB_SNAPSHOT_RE } from "../scripts/lib/backup-set.mjs";

const root = path.join(process.cwd(), "test", ".tmp-backup");
mkdirSync(root, { recursive: true });

let counter = 0;
function scratchDir(name) {
  const dir = path.join(root, `${name}-${process.pid}-${counter++}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Builds a fixture app dir: real schema (via the real migration runner),
 * a couple of rows referencing a couple of fake media files, plus fake
 * config. Returns { appDir, dbPath }. */
function buildFixtureApp(appDir) {
  const dbPath = path.join(appDir, "storage", "grader.db");
  migrate(dbPath); // full real schema, same as any other test in this repo

  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.prepare(`INSERT INTO users (email, name, global_role, status) VALUES (?, ?, 'admin', 'active')`).run(
    "prof@byu.edu",
    "Professor Fixture",
  );
  db.prepare(`INSERT INTO courses (name, code, year, term) VALUES (?, ?, ?, ?)`).run("Intro 3D", "ART 101", 2026, "Fall");
  db.prepare(`INSERT INTO students (name, sort_name) VALUES (?, ?)`).run("Student One", "One, Student");
  db.prepare(
    `INSERT INTO assignments (course_id, name, points_possible, submission_type) VALUES (1, ?, 100, 'image')`,
  ).run("Project 1");
  db.prepare(`INSERT INTO rubrics (name) VALUES (?)`).run("Basic rubric");

  const relFile = path.join("storage", "submissions", "1", "1", "photo.png");
  const relThumb = path.join("storage", "thumbnails", "1", "1", "photo-thumb.png");
  db.prepare(
    `INSERT INTO submissions (assignment_id, student_id, file_path, file_name, file_type, media_type, thumbnail_path)
     VALUES (1, 1, ?, 'photo.png', 'image/png', 'image', ?)`,
  ).run(relFile, relThumb);
  db.prepare(`INSERT INTO grades (assignment_id, student_id, submission_id, status) VALUES (1, 1, 1, 'ungraded')`).run();
  db.close();

  for (const rel of [relFile, relThumb]) {
    const full = path.join(appDir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, "not-really-a-png");
  }
  mkdirSync(path.join(appDir, "storage", "review"), { recursive: true });

  writeFileSync(path.join(appDir, ".env"), "APP_BASE_URL=http://example.test\n");
  writeFileSync(path.join(appDir, ".env.local"), "SMTP_HOST=smtp.example.test\nSMTP_PASS=super-secret\n");
  mkdirSync(path.join(appDir, "certs"), { recursive: true });
  writeFileSync(path.join(appDir, "certs", "cert.pem"), "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n");

  return { appDir, dbPath };
}

test("backup -> restore --verify round-trips DB rows, media, and config", async () => {
  const appDir = scratchDir("app");
  const dest = scratchDir("dest");
  buildFixtureApp(appDir);

  const backupResult = await runBackup({
    APP_DIR: appDir,
    DB_PATH: path.join(appDir, "storage", "grader.db"),
    BACKUP_DEST: dest,
    BACKUP_KEEP: "5",
  });
  assert.equal(backupResult.ok, true, backupResult.error);
  assert.equal(backupResult.mode, "local");
  assert.ok(existsSync(path.join(dest, "db", backupResult.dbSnapshot)));
  assert.ok(existsSync(path.join(dest, "media", "submissions", "1", "1", "photo.png")));
  assert.ok(existsSync(path.join(dest, "config", ".env")));
  assert.ok(existsSync(path.join(dest, "status.json")));

  const report = await runRestore(["--dest", dest, "--verify"], { APP_DIR: appDir });
  assert.equal(report.verify.integrity, "ok");
  assert.equal(report.verify.counts.users, 1);
  assert.equal(report.verify.counts.courses, 1);
  assert.equal(report.verify.counts.students, 1);
  assert.equal(report.verify.counts.assignments, 1);
  assert.equal(report.verify.counts.submissions, 1);
  assert.equal(report.verify.counts.grades, 1);
  assert.equal(report.verify.counts.rubrics, 1);
  assert.deepEqual(report.verify.missingFiles, []);
  assert.equal(report.verify.ok, true);

  // Restored target is a temp dir laid out like the app, not the fixture app itself.
  assert.notEqual(path.resolve(report.target), path.resolve(appDir));
  assert.ok(existsSync(path.join(report.target, "storage", "submissions", "1", "1", "photo.png")));
  assert.ok(existsSync(path.join(report.target, ".env")));
  rmSync(report.target, { recursive: true, force: true });
});

test("retention prunes only old grader-*.db snapshots, keeping BACKUP_KEEP", () => {
  const dest = scratchDir("dest");
  const dbDir = path.join(dest, "db");
  mkdirSync(dbDir, { recursive: true });

  const names = [
    "grader-2026-09-01-030000.db",
    "grader-2026-09-02-030000.db",
    "grader-2026-09-03-030000.db",
    "grader-2026-09-04-030000.db",
    "grader-2026-09-05-030000.db",
  ];
  for (const name of names) writeFileSync(path.join(dbDir, name), "x");
  // A file that merely lives alongside the snapshots — must never be touched.
  writeFileSync(path.join(dbDir, "README.txt"), "not a snapshot");

  assert.equal(pruneDbSnapshots(dest, 2), 3);
  const remaining = readdirSync(dbDir).sort();
  assert.deepEqual(remaining, ["README.txt", "grader-2026-09-04-030000.db", "grader-2026-09-05-030000.db"]);
  assert.deepEqual(listDbSnapshots(dest), ["grader-2026-09-04-030000.db", "grader-2026-09-05-030000.db"]);

  // Idempotent: pruning again with the same keep count deletes nothing further.
  assert.equal(pruneDbSnapshots(dest, 2), 0);
});

test("DB_SNAPSHOT_RE only matches the real naming pattern", () => {
  assert.ok(DB_SNAPSHOT_RE.test("grader-2026-09-05-030000.db"));
  assert.ok(DB_SNAPSHOT_RE.test("grader-2026-09-05-030000.db.age"));
  assert.ok(!DB_SNAPSHOT_RE.test("grader.db"));
  assert.ok(!DB_SNAPSHOT_RE.test("README.txt"));
  assert.ok(!DB_SNAPSHOT_RE.test("grader-2026-09-05-030000.db.bak"));
});

test("assertSafeDirectory refuses '/', '', and the app directory", () => {
  assert.throws(() => assertSafeDirectory("/"));
  assert.throws(() => assertSafeDirectory(""));
  assert.throws(() => assertSafeDirectory("   "));
  const appDir = "/work/cnh5/grader";
  assert.throws(() => assertSafeDirectory(appDir, { appDir }));
  assert.doesNotThrow(() => assertSafeDirectory("/mnt/backup/grader", { appDir }));
});

test("backup refuses a destination that is the app directory itself", async () => {
  const appDir = scratchDir("app");
  buildFixtureApp(appDir);

  const result = await runBackup({
    APP_DIR: appDir,
    DB_PATH: path.join(appDir, "storage", "grader.db"),
    BACKUP_DEST: appDir,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /app directory/);
});

test("restore --into-live refuses without --yes and --confirm-service-stopped", async () => {
  const appDir = scratchDir("app");
  const dest = scratchDir("dest");
  buildFixtureApp(appDir);
  await runBackup({ APP_DIR: appDir, DB_PATH: path.join(appDir, "storage", "grader.db"), BACKUP_DEST: dest });

  await assert.rejects(() => runRestore(["--dest", dest, "--into-live"], { APP_DIR: appDir }), /--yes/);
  await assert.rejects(
    () => runRestore(["--dest", dest, "--into-live", "--yes"], { APP_DIR: appDir }),
    /confirm-service-stopped/,
  );
});

test("restore --into-live proceeds once both safety flags are given", async () => {
  const appDir = scratchDir("app");
  const dest = scratchDir("dest");
  buildFixtureApp(appDir);
  await runBackup({ APP_DIR: appDir, DB_PATH: path.join(appDir, "storage", "grader.db"), BACKUP_DEST: dest });

  // Mutate the "live" DB after the backup so restoring it back is observable.
  // grades has nothing referencing it (no annotations in this fixture), so
  // this doesn't trip the foreign_keys=ON pragma the way deleting a
  // referenced row (e.g. students) would.
  const db = new Database(path.join(appDir, "storage", "grader.db"));
  db.prepare("DELETE FROM grades").run();
  db.close();

  const report = await runRestore(
    ["--dest", dest, "--into-live", "--yes", "--confirm-service-stopped", "--verify"],
    { APP_DIR: appDir },
  );
  assert.equal(path.resolve(report.target), path.resolve(appDir));
  assert.equal(report.verify.counts.grades, 1); // restored, not the deleted state
});
