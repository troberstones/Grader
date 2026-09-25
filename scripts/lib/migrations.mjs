#!/usr/bin/env node
/**
 * Shared migration engine for scripts/migrate.mjs, scripts/init-db.mjs and
 * test/global-setup.ts, so "a fresh database" and "a database migrated in
 * production" always end up with the same schema.
 *
 * drizzle/meta/_journal.json only records 0000 — later files (0001–0014)
 * were added by hand without ever running `drizzle-kit generate` again, so
 * the journal is not the source of truth and `drizzle-kit migrate` cannot be
 * used against this folder (it would think none of 0001–0014 have run and
 * try to replay them against the 0000 snapshot). Filename order
 * (`0001_*.sql`, `0002_*.sql`, ...) is the source of truth instead.
 *
 * How a run decides what to do:
 *
 *   - No `schema_migrations` table yet: this is either a brand-new database
 *     (nothing exists at all) or a pre-existing one that predates this
 *     runner — most of drizzle/0001–0013 were never applied via their own
 *     SQL file in production. Instead they were applied via a hand-written
 *     `scripts/apply-*.mjs` twin (now under scripts/legacy-migrations/,
 *     see the README there) that checked column/table presence itself and
 *     sometimes did extra work no plain SQL file can (e.g. backfilling
 *     `courses.year`/`term` by parsing the old `semester` text). Either way,
 *     we "baseline" the database: for every drizzle/NNNN_*.sql file, in
 *     order, we look for a concrete artifact it creates (a table, column,
 *     or index) via sqlite_master / PRAGMA table_info. If the artifact is
 *     already there, the migration is recorded as applied *without*
 *     re-running its SQL — re-running a bare `ALTER TABLE ... ADD COLUMN`
 *     against a column that already exists throws. If the artifact is
 *     missing, the migration actually runs. On a truly empty database every
 *     probe comes back false, so this ends up running every migration in
 *     order — baselining and "create from scratch" are the same code path.
 *   - `schema_migrations` already exists: normal incremental mode. Anything
 *     not yet recorded gets applied, in filename order.
 *
 * Each migration that actually runs does so in its own transaction — SQL
 * split the same way the old apply-*.mjs scripts and test/global-setup.ts
 * already did, on `--> statement-breakpoint` — and is recorded in
 * `schema_migrations` immediately after. None of the existing appliers ever
 * needed to disable `foreign_keys` around a table rebuild (SQLite's native
 * ADD/DROP/RENAME COLUMN don't require it — see the comment in
 * drizzle/0014_rubric_share_model.sql), so this runner doesn't either; it
 * just leaves `foreign_keys = ON` on throughout, like every apply-*.mjs did.
 *
 * A statement that fails with "duplicate column name" or "already exists"
 * (for an ADD COLUMN / CREATE TABLE / CREATE INDEX without an `IF NOT
 * EXISTS` guard) is treated as evidence the statement was already applied
 * by some earlier, untracked run — e.g. a legacy apply-*.mjs script that
 * only got partway through what is now one migration file — rather than a
 * fatal error. It's logged and skipped so the migration can still finish
 * and be recorded as applied. This is what makes drizzle/0014 safe to run
 * even against a database that already has some but not all of its
 * columns (see the note in that file).
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MIGRATION_FILE_RE = /^\d{4}_.*\.sql$/;

/** Split a migration file's SQL the same way on every call site in this repo. */
export function splitStatements(sql) {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s && !s.split("\n").every((l) => l.trim().startsWith("--") || l.trim() === ""));
}

export function listMigrationFiles(drizzleDir) {
  return readdirSync(drizzleDir)
    .filter((f) => MIGRATION_FILE_RE.test(f))
    .sort();
}

function tableExists(db, table) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

function columnInfo(db, table, column) {
  if (!tableExists(db, table)) return undefined;
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .find((c) => c.name === column);
}

function columnExists(db, table, column) {
  return !!columnInfo(db, table, column);
}

/**
 * One probe per migration file: a concrete, cheap-to-check artifact that
 * only exists once that migration's effect has landed. Used only to
 * baseline a database that has no schema_migrations table yet — a fully
 * tracked database just consults schema_migrations instead.
 *
 * Every one of 0001–0013 has a legacy scripts/legacy-migrations/apply-*.mjs
 * twin that was the *actual* mechanism that ran against production (see the
 * module comment above), except 0001–0004, which — per the migration
 * history — never had an applier at all and so are genuinely still pending
 * on a database that has never run `drizzle-kit push` or this runner. All
 * four are purely additive (nullable columns, or relaxing a unique index),
 * so it's safe for this runner to apply them for real the first time it
 * baselines such a database.
 *
 * A probe must only assert the *positive* presence of something a migration
 * creates — never the absence of something it removes. All the probes below
 * run once, up front, against a single snapshot of the database (baselining
 * doesn't simulate running earlier migrations before probing later ones), so
 * an absence-based probe (e.g. "this index is gone") would be vacuously true
 * on a database that hasn't even reached the migration that first creates
 * the thing it later removes, causing that removal step to be wrongly
 * skipped. Migrations that only ever remove/relax something (0003) are
 * listed in ALWAYS_APPLY_ON_BASELINE instead, below.
 */
const ARTIFACT_PROBES = {
  "0000_loud_hitman.sql": (db) => tableExists(db, "courses"),
  "0001_add_lms_gradebook_id.sql": (db) => columnExists(db, "assignments", "lms_gradebook_id"),
  "0002_add_lms_discussion_url.sql": (db) => columnExists(db, "assignments", "lms_discussion_url"),
  "0004_rubric_settings.sql": (db) => columnExists(db, "rubrics", "settings"),
  "0005_art_review.sql": (db) => tableExists(db, "review_media"),
  "0006_auth.sql": (db) => tableExists(db, "users"),
  "0007_course_terms.sql": (db) =>
    columnExists(db, "courses", "year") &&
    columnExists(db, "courses", "term") &&
    !columnExists(db, "courses", "semester"),
  "0008_active_course.sql": (db) => columnExists(db, "users", "active_course_id"),
  "0009_course_membership.sql": (db) => tableExists(db, "course_members"),
  "0010_security_hardening.sql": (db) => tableExists(db, "audit_log"),
  "0011_upload_links.sql": (db) => tableExists(db, "upload_links"),
  "0012_session_mode.sql": (db) => columnExists(db, "sessions", "mode"),
  "0013_feedback.sql": (db) => tableExists(db, "feedback_sends") && tableExists(db, "feedback_links"),
};

/**
 * Migrations that are never baseline-skipped, even when their effect is
 * already fully present — they always actually run during a baseline pass,
 * relying on their own SQL being safe to re-apply rather than on a probe:
 *
 *   - 0003_drop_submission_unique.sql is `DROP INDEX IF EXISTS ...`, already
 *     idempotent by construction, and (per the note above) an absence-based
 *     probe for it would be unsafe to evaluate up front anyway.
 *   - 0014_rubric_share_model.sql is the one migration known to have been
 *     applied historically by an ad hoc script (see scripts/legacy-migrations/
 *     apply-rubric-share-model-migration.mjs) whose effect is otherwise
 *     indistinguishable, by schema inspection, from 0014 itself having run.
 *     Always running it — tolerant of columns that already exist (see
 *     execStatement below) and safe to redo even when fully applied, since
 *     the points rebuild only requires the *current* `points` column to
 *     exist, not to be missing — means baselining never has to guess.
 */
const ALWAYS_APPLY_ON_BASELINE = new Set(["0003_drop_submission_unique.sql", "0014_rubric_share_model.sql"]);

function probeArtifact(file, db) {
  const probe = ARTIFACT_PROBES[file];
  if (!probe) {
    throw new Error(
      `No baseline artifact probe registered for ${file} — add one to ARTIFACT_PROBES (or ALWAYS_APPLY_ON_BASELINE) in scripts/lib/migrations.mjs.`,
    );
  }
  return probe(db);
}

function hasMigrationsTable(db) {
  return tableExists(db, "schema_migrations");
}

function ensureMigrationsTable(db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
}

function getAppliedNames(db) {
  return new Set(db.prepare("SELECT name FROM schema_migrations").all().map((r) => r.name));
}

function recordApplied(db, name, note) {
  db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(name, note ?? new Date().toISOString());
}

const ALREADY_APPLIED_ERROR = /duplicate column name|already exists/i;

function execStatement(db, statement) {
  try {
    db.exec(statement);
  } catch (err) {
    if (ALREADY_APPLIED_ERROR.test(err.message ?? "")) {
      console.warn(`    (already applied, skipping) ${err.message}`);
      return;
    }
    throw err;
  }
}

function runMigrationFile(db, drizzleDir, file) {
  const sql = readFileSync(path.join(drizzleDir, file), "utf8");
  const statements = splitStatements(sql);
  const apply = db.transaction(() => {
    for (const statement of statements) execStatement(db, statement);
    recordApplied(db, file);
  });
  apply();
}

/**
 * Compute what would happen for each migration file. Only reads the
 * database (sqlite_master / PRAGMA table_info, and schema_migrations if it
 * exists) — never writes.
 */
export function planMigrations(db, drizzleDir) {
  const files = listMigrationFiles(drizzleDir);
  const baselining = !hasMigrationsTable(db);
  const applied = baselining ? new Set() : getAppliedNames(db);

  return files.map((file) => {
    if (applied.has(file)) return { file, action: "skip-tracked" };
    if (baselining && !ALWAYS_APPLY_ON_BASELINE.has(file) && probeArtifact(file, db)) {
      return { file, action: "skip-baseline" };
    }
    return { file, action: "apply" };
  });
}

function describeAction(action) {
  switch (action) {
    case "skip-tracked":
      return "already applied";
    case "skip-baseline":
      return "baseline (artifact already present)";
    default:
      return "APPLY";
  }
}

function printPlan(plan) {
  console.log("Migration plan:");
  for (const { file, action } of plan) {
    console.log(`  ${file}: ${describeAction(action)}`);
  }
}

/**
 * Migrate `dbPath` up to the latest drizzle/NNNN_*.sql migration. Safe to
 * call repeatedly — a fully migrated database is a no-op. Always prints the
 * plan before doing anything (this is the part that needs eyes on it when
 * pointed at a production database for the first time).
 *
 * Returns the plan that was computed (and, unless `dryRun`, executed).
 */
export function migrate(dbPath, { drizzleDir = path.join(process.cwd(), "drizzle"), dryRun = false } = {}) {
  // Don't even create an empty sqlite file for a pure dry-run against a
  // database that doesn't exist yet — every probe would be false anyway.
  if (dryRun && !existsSync(dbPath)) {
    const plan = listMigrationFiles(drizzleDir).map((file) => ({ file, action: "apply" }));
    printPlan(plan);
    console.log(`(${dbPath} does not exist yet — every migration above would run.)`);
    return plan;
  }

  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  try {
    const plan = planMigrations(db, drizzleDir);
    printPlan(plan);
    if (dryRun) return plan;

    ensureMigrationsTable(db);

    for (const { file, action } of plan) {
      if (action === "skip-tracked") continue;
      if (action === "skip-baseline") {
        recordApplied(db, file, `baseline:${new Date().toISOString()}`);
        console.log(`  ${file}: recorded as already applied (baseline)`);
        continue;
      }
      console.log(`  ${file}: applying...`);
      runMigrationFile(db, drizzleDir, file);
    }

    return plan;
  } finally {
    db.close();
  }
}
