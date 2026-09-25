#!/usr/bin/env node
/**
 * Applies drizzle/0007_course_terms.sql, plus the backfill the SQL file can't
 * express: `courses.semester` is free text that already drifted ("Winter
 * 2026", "winter 2026", "last year"), so turning it into structured
 * year/term columns needs a parse, not just an ALTER TABLE.
 *
 * Column presence is checked via PRAGMA table_info rather than
 * `IF NOT EXISTS`, so this is idempotent and safe to re-run — including
 * after `semester` has already been dropped on a previous run.
 *
 *   node scripts/apply-course-terms-migration.mjs
 */
import Database from "better-sqlite3";

const dbPath = process.env.DB_PATH || "storage/grader.db";
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const TERM_KEYWORDS = ["winter", "spring", "summer", "fall"];
const currentYear = new Date().getFullYear();

function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function addColumnIfMissing(table, column, type) {
  if (!columns(table).includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`Added ${table}.${column}`);
  }
}

/** Best-effort parse of the old free-text semester field. */
function parseSemester(text) {
  const yearMatch = /(19|20)\d{2}/.exec(text ?? "");
  const termMatch = new RegExp(TERM_KEYWORDS.join("|"), "i").exec(text ?? "");
  return {
    year: yearMatch ? Number(yearMatch[0]) : currentYear,
    term: termMatch ? termMatch[0].toLowerCase() : "fall",
    guessed: !yearMatch || !termMatch,
  };
}

const tx = db.transaction(() => {
  addColumnIfMissing("courses", "year", "integer");
  addColumnIfMissing("courses", "term", "text");
  addColumnIfMissing("users", "default_course_year", "integer");
  addColumnIfMissing("users", "default_course_term", "text");

  if (columns("courses").includes("semester")) {
    const rows = db.prepare("SELECT id, name, semester FROM courses WHERE year IS NULL OR term IS NULL").all();
    const update = db.prepare("UPDATE courses SET year = ?, term = ? WHERE id = ?");
    for (const row of rows) {
      const { year, term, guessed } = parseSemester(row.semester);
      update.run(year, term, row.id);
      if (guessed) {
        console.log(`Guessed ${year} ${term} for course #${row.id} "${row.name}" (was "${row.semester}") — check it`);
      }
    }
    db.exec("ALTER TABLE courses DROP COLUMN semester");
    console.log("Dropped courses.semester");
  }
});
tx();

const courseCount = db.prepare("SELECT count(*) AS n FROM courses").get().n;
console.log(`courses table: ${courseCount} row(s), year/term populated.`);
