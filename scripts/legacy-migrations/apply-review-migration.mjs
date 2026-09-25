#!/usr/bin/env node
/**
 * Applies drizzle/0005_art_review.sql directly.
 *
 * The drizzle journal in this repo only records 0000 while 0001–0004 exist as
 * loose SQL, so the migration folder is not the source of truth here. This
 * script is idempotent (every statement is IF NOT EXISTS) and safe to re-run.
 *
 *   node scripts/apply-review-migration.mjs
 */
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";

const dbPath = process.env.DB_PATH || path.join(process.cwd(), "storage", "grader.db");
const sqlPath = path.join(process.cwd(), "drizzle", "0005_art_review.sql");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const sql = readFileSync(sqlPath, "utf8");
const statements = sql
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter((s) => s && !s.split("\n").every((l) => l.trim().startsWith("--")));

let applied = 0;
const tx = db.transaction(() => {
  for (const statement of statements) {
    db.exec(statement);
    applied++;
  }
});
tx();

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'review_%' ORDER BY name")
  .all()
  .map((r) => r.name);

console.log(`applied ${applied} statement(s) to ${dbPath}`);
console.log(`review tables present: ${tables.join(", ") || "(none)"}`);
db.close();
