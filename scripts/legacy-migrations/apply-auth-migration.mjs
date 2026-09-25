#!/usr/bin/env node
/**
 * Applies drizzle/0006_auth.sql directly.
 *
 * Same reasoning as apply-review-migration.mjs: the drizzle journal in this repo
 * only records 0000 while later migrations exist as loose SQL, so the migration
 * folder is not the source of truth. Every statement is IF NOT EXISTS, so this
 * is idempotent and safe to re-run.
 *
 *   node scripts/apply-auth-migration.mjs
 */
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";

const dbPath = process.env.DB_PATH || path.join(process.cwd(), "storage", "grader.db");
const sqlPath = path.join(process.cwd(), "drizzle", "0006_auth.sql");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const statements = readFileSync(sqlPath, "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter((s) => s && !s.split("\n").every((l) => l.trim().startsWith("--")));

const tx = db.transaction(() => {
  for (const statement of statements) db.exec(statement);
});
tx();

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','sessions','invites') ORDER BY name")
  .all()
  .map((r) => r.name);

const userCount = db.prepare("SELECT count(*) AS n FROM users").get().n;

console.log(`Applied ${statements.length} statements to ${dbPath}`);
console.log(`Tables: ${tables.join(", ")}`);
console.log(
  userCount === 0
    ? "No users yet — the app will open at /setup to create the first administrator."
    : `${userCount} user${userCount === 1 ? "" : "s"} already registered.`,
);
