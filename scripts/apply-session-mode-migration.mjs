#!/usr/bin/env node
/**
 * Applies drizzle/0012_session_mode.sql: the review/grade mode chosen at sign-in,
 * stored on the session row rather than in a cookie so it cannot be edited by
 * the browser holding it.
 *
 * Column presence is checked directly rather than `IF NOT EXISTS`, so this is
 * idempotent and safe to re-run — same shape as the other appliers here.
 *
 * Existing sessions default to 'grade', which is exactly how they behaved
 * before this column existed, so nobody signed in during the deploy is
 * silently dropped into a restricted session.
 *
 *   node scripts/apply-session-mode-migration.mjs
 */
import Database from "better-sqlite3";

const dbPath = process.env.DB_PATH || "storage/grader.db";
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

if (!columns("sessions").includes("mode")) {
  db.exec("ALTER TABLE sessions ADD COLUMN mode text DEFAULT 'grade' NOT NULL");
  console.log("Added sessions.mode");
} else {
  console.log("sessions.mode already present — nothing to do.");
}

db.close();
