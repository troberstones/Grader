#!/usr/bin/env node
/**
 * Applies drizzle/0013_feedback.sql: `feedback_sends` (the record of every
 * feedback email) and `feedback_links` (read-only links to a student's own
 * feedback). Both are new tables, so nothing existing is touched.
 *
 * Table presence is checked directly rather than `IF NOT EXISTS`, so this is
 * idempotent and safe to re-run.
 *
 *   node scripts/apply-feedback-migration.mjs
 */
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";

const dbPath = process.env.DB_PATH || "storage/grader.db";
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function tableExists(table) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

if (tableExists("feedback_sends") && tableExists("feedback_links")) {
  console.log("feedback_sends and feedback_links already exist — nothing to do.");
  process.exit(0);
}

const statements = readFileSync(path.join(process.cwd(), "drizzle", "0013_feedback.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

const tx = db.transaction(() => {
  for (const statement of statements) {
    const table = /CREATE TABLE `(\w+)`/.exec(statement)?.[1] ?? /ON `(\w+)`/.exec(statement)?.[1];
    // Only replay statements for a table this database does not have yet.
    if (table && tableExists(table) && statement.startsWith("CREATE TABLE")) continue;
    if (table && statement.includes("INDEX")) {
      const index = /INDEX `(\w+)`/.exec(statement)?.[1];
      if (index && db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(index)) continue;
    }
    db.exec(statement);
  }
});
tx();

console.log("Created feedback_sends and feedback_links.");
