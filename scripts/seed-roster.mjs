#!/usr/bin/env node
/**
 * Seed a course roster from testData/roster.json
 *
 * Usage:
 *   node scripts/seed-roster.mjs              # imports into course id 1 (default)
 *   node scripts/seed-roster.mjs --course 2   # imports into course id 2
 *   node scripts/seed-roster.mjs --list        # list available courses
 */

import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const DB_PATH = resolve(root, "storage", "grader.db");
const ROSTER_PATH = resolve(root, "testData", "roster.json");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes("--list")) {
  const courses = db.prepare("SELECT id, code, name, semester FROM courses ORDER BY id").all();
  console.log("\nAvailable courses:");
  courses.forEach((c) => console.log(`  [${c.id}] ${c.code} — ${c.name} (${c.semester})`));
  process.exit(0);
}

const courseArgIdx = args.indexOf("--course");
const courseId = courseArgIdx !== -1 ? Number(args[courseArgIdx + 1]) : 1;

// ── Verify course exists ─────────────────────────────────────────────────────
const course = db.prepare("SELECT * FROM courses WHERE id = ?").get(courseId);
if (!course) {
  console.error(`Course id ${courseId} not found. Run with --list to see available courses.`);
  process.exit(1);
}
console.log(`\nImporting roster into: [${course.id}] ${course.code} — ${course.name}`);

// ── Load JSON ─────────────────────────────────────────────────────────────────
const roster = JSON.parse(readFileSync(ROSTER_PATH, "utf8"));
const students = roster.students;
console.log(`Found ${students.length} students in roster.json\n`);

// ── Prepared statements ───────────────────────────────────────────────────────
const findByNetId    = db.prepare("SELECT id FROM students WHERE net_id = ?");
const insertStudent  = db.prepare(`
  INSERT INTO students (name, sort_name, net_id)
  VALUES (@name, @sortName, @netId)
`);
const updateStudent  = db.prepare(`
  UPDATE students SET name = @name, sort_name = @sortName WHERE id = @id
`);
const findEnrollment = db.prepare(`
  SELECT id FROM course_enrollments WHERE course_id = ? AND student_id = ?
`);
const insertEnroll   = db.prepare(`
  INSERT INTO course_enrollments (course_id, student_id) VALUES (?, ?)
`);

// ── Import ────────────────────────────────────────────────────────────────────
let created = 0, updated = 0, enrolled = 0, alreadyEnrolled = 0;

const run = db.transaction(() => {
  for (const s of students) {
    let studentId;
    const existing = findByNetId.get(s.netId);

    if (existing) {
      updateStudent.run({ id: existing.id, name: s.name, sortName: s.sortName });
      studentId = existing.id;
      updated++;
    } else {
      const result = insertStudent.run({ name: s.name, sortName: s.sortName, netId: s.netId });
      studentId = result.lastInsertRowid;
      created++;
    }

    const existingEnrollment = findEnrollment.get(courseId, studentId);
    if (!existingEnrollment) {
      insertEnroll.run(courseId, studentId);
      enrolled++;
      console.log(`  + Enrolled: ${s.sortName} (${s.netId})`);
    } else {
      alreadyEnrolled++;
      console.log(`  ~ Already enrolled: ${s.sortName} (${s.netId})`);
    }
  }
});

run();

console.log(`
Done!
  Students created:        ${created}
  Students updated:        ${updated}
  New enrollments:         ${enrolled}
  Already enrolled:        ${alreadyEnrolled}
`);

db.close();
