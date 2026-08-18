#!/usr/bin/env node
/**
 * Builds a fresh database from nothing — the one thing this repo didn't
 * have a documented, single-command way to do. Every other apply-*.mjs
 * script in this directory assumes the base schema already exists (they add
 * columns/tables to it); this is what creates that base schema in the first
 * place, by replaying every drizzle/*.sql file in filename order.
 *
 * Idempotent: does nothing if `users` already exists, so it's safe to run
 * on a clone that already has a populated storage/grader.db.
 *
 *   node scripts/init-db.mjs
 *   DB_PATH=... node scripts/init-db.mjs
 */
import Database from "better-sqlite3";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const dbPath = process.env.DB_PATH || path.join(process.cwd(), "storage", "grader.db");
mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const alreadyInitialized = !!db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")
  .get();

if (alreadyInitialized) {
  console.log(`${dbPath} already has a schema — nothing to do. Run the individual`);
  console.log("scripts/apply-*-migration.mjs scripts if you're bringing an older database up to date.");
  db.close();
  process.exit(0);
}

const drizzleDir = path.join(process.cwd(), "drizzle");
const files = readdirSync(drizzleDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const tx = db.transaction(() => {
  for (const file of files) {
    const statements = readFileSync(path.join(drizzleDir, file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s && !s.split("\n").every((l) => l.trim().startsWith("--")));
    for (const statement of statements) db.exec(statement);
  }

  // scripts/apply-rubric-share-model-migration.mjs was applied to real
  // databases directly and never got a paired drizzle/*.sql file (unlike
  // every other migration here) — replayed explicitly so a fresh database
  // actually matches what's deployed instead of silently missing these.
  db.exec("ALTER TABLE rubric_criteria ADD COLUMN archived integer DEFAULT 0 NOT NULL");
  db.exec("ALTER TABLE grade_entries ADD COLUMN nudge integer");
});
tx();

const tables = db
  .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'")
  .get().n;
console.log(`Initialized ${dbPath} — ${tables} tables from ${files.length} migration files.`);
console.log("Run `npm run dev` and open /setup to create the first administrator.");
db.close();
