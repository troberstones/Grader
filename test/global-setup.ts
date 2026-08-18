/**
 * Runs once before any test file. Builds a fresh scratch DB at the same
 * DB_PATH vitest.config.ts sets, by replaying every drizzle/*.sql file in
 * order — same statement-breakpoint split logic already used in
 * scripts/apply-auth-migration.mjs — so the migration folder stays the
 * single source of schema truth for tests too, instead of a second
 * hand-maintained schema.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const TEST_DB_PATH = path.join(process.cwd(), "test", ".db", "vitest.db");

export default function setup() {
  const dir = path.dirname(TEST_DB_PATH);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const db = new Database(TEST_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const drizzleDir = path.join(process.cwd(), "drizzle");
  const files = readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const statements = readFileSync(path.join(drizzleDir, file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s && !s.split("\n").every((l) => l.trim().startsWith("--")));
    for (const statement of statements) db.exec(statement);
  }

  // scripts/apply-rubric-share-model-migration.mjs was applied to real
  // databases directly and never got a paired drizzle/*.sql file (unlike
  // every other migration in this repo) — a pre-existing gap, not something
  // introduced here. Replayed explicitly so the schema this builds actually
  // matches production instead of silently missing these two columns.
  db.exec("ALTER TABLE rubric_criteria ADD COLUMN archived integer DEFAULT 0 NOT NULL");
  db.exec("ALTER TABLE grade_entries ADD COLUMN nudge integer");

  db.close();
}
