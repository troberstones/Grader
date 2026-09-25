#!/usr/bin/env node
/**
 * Applies drizzle/0008_active_course.sql. Column presence is checked via
 * PRAGMA table_info rather than `IF NOT EXISTS`, so this is idempotent and
 * safe to re-run.
 *
 *   node scripts/apply-active-course-migration.mjs
 */
import Database from "better-sqlite3";

const dbPath = process.env.DB_PATH || "storage/grader.db";
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const hasColumn = db
  .prepare("PRAGMA table_info(users)")
  .all()
  .some((c) => c.name === "active_course_id");

if (hasColumn) {
  console.log("users.active_course_id already exists — nothing to do.");
} else {
  db.exec("ALTER TABLE users ADD COLUMN active_course_id integer");
  console.log("Added users.active_course_id");
}
