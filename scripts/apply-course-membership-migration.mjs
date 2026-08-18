#!/usr/bin/env node
/**
 * Applies drizzle/0009_course_membership.sql, plus the backfill the SQL file
 * can't express: existing courses have no `course_members` rows at all, and
 * enforcing membership without backfilling first would lock every current
 * instructor out of every course that already exists — including whatever
 * is live on the deployed server. So every currently-active instructor
 * becomes an 'owner' of every pre-existing course. Courses created after
 * this migration only get their actual creator as owner (see createCourse()
 * in src/actions/courses.ts).
 *
 * Column/table presence is checked directly rather than `IF NOT EXISTS`, so
 * this is idempotent and safe to re-run.
 *
 *   node scripts/apply-course-membership-migration.mjs
 */
import Database from "better-sqlite3";

const dbPath = process.env.DB_PATH || "storage/grader.db";
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function addColumnIfMissing(table, column, ddl) {
  if (!columns(table).includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    console.log(`Added ${table}.${column}`);
  }
}

function tableExists(table) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

const tx = db.transaction(() => {
  if (!tableExists("course_members")) {
    db.exec(`
      CREATE TABLE course_members (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        course_id integer NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role text NOT NULL,
        added_at text DEFAULT (datetime('now')) NOT NULL,
        added_by integer REFERENCES users(id)
      )
    `);
    db.exec("CREATE UNIQUE INDEX course_members_unique_idx ON course_members (course_id, user_id)");
    db.exec("CREATE INDEX course_members_user_idx ON course_members (user_id)");
    console.log("Created course_members");
  }

  addColumnIfMissing("courses", "visibility", "visibility text DEFAULT 'department' NOT NULL");
  addColumnIfMissing("courses", "lineage_id", "lineage_id integer");
  addColumnIfMissing("courses", "copied_from_id", "copied_from_id integer");
  addColumnIfMissing("courses", "start_date", "start_date text");
  addColumnIfMissing("assignments", "sort_order", "sort_order integer DEFAULT 0 NOT NULL");
  addColumnIfMissing("users", "can_view_archive", "can_view_archive integer DEFAULT 0 NOT NULL");
  addColumnIfMissing("students", "user_id", "user_id integer REFERENCES users(id)");

  db.exec("UPDATE courses SET lineage_id = id WHERE lineage_id IS NULL");

  const courses = db.prepare("SELECT id FROM courses").all();
  const activeInstructors = db
    .prepare("SELECT id FROM users WHERE global_role = 'instructor' AND status = 'active'")
    .all();
  const insertOwner = db.prepare(
    "INSERT OR IGNORE INTO course_members (course_id, user_id, role, added_by) VALUES (?, ?, 'owner', NULL)"
  );
  let inserted = 0;
  for (const course of courses) {
    for (const user of activeInstructors) {
      const result = insertOwner.run(course.id, user.id);
      inserted += result.changes;
    }
  }
  console.log(
    `Backfilled ${inserted} owner membership row(s) across ${courses.length} course(s) and ` +
      `${activeInstructors.length} active instructor(s).`
  );
});
tx();

const memberCount = db.prepare("SELECT count(*) AS n FROM course_members").get().n;
console.log(`course_members table: ${memberCount} row(s) total.`);
