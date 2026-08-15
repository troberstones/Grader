#!/usr/bin/env node
/**
 * Register a folder of numbered frames as one submission.
 *
 * A render sequence is a directory, and the upload route takes one file at a
 * time — so this is the way a shot gets in. The folder is copied under
 * storage/ because the media route refuses to serve anything outside it, and
 * because a submission that points at a scratch render directory breaks the
 * moment that directory is cleaned up.
 *
 *   npm run review:import-sequence -- <folder> <assignmentId> <studentId>
 *
 * Derivatives are built on first open, or eagerly with `npm run review:ingest`.
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const [dir, assignmentId, studentId] = process.argv.slice(2);

if (!dir || !assignmentId || !studentId) {
  console.error("usage: npm run review:import-sequence -- <folder> <assignmentId> <studentId>");
  process.exit(1);
}
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(`Not a directory: ${dir}`);
  process.exit(1);
}

const FRAME_EXT = new Set([".exr", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".dpx", ".tga"]);
const frames = fs
  .readdirSync(dir)
  .filter((f) => !f.startsWith(".") && FRAME_EXT.has(path.extname(f).toLowerCase()))
  // The last run of digits is the frame field — matches frameNumberOf in the
  // ingest module, which is what actually orders playback.
  .filter((f) => /\d(?!.*\d)/.test(path.basename(f, path.extname(f))));

if (frames.length === 0) {
  console.error(`No numbered frames in ${dir}`);
  process.exit(1);
}

const db = new Database("storage/grader.db");

const student = db
  .prepare("SELECT id, name FROM students WHERE id = ?")
  .get(Number(studentId));
const assignment = db
  .prepare("SELECT id, name FROM assignments WHERE id = ?")
  .get(Number(assignmentId));
if (!student || !assignment) {
  console.error(`No such ${student ? "assignment" : "student"}`);
  process.exit(1);
}

const name = path.basename(path.resolve(dir));
const relDir = path.join("storage", "submissions", String(assignmentId), String(studentId), name);
const absDir = path.join(process.cwd(), relDir);

console.log(`${frames.length} frames → ${student.name} · ${assignment.name}`);
fs.mkdirSync(absDir, { recursive: true });
let bytes = 0;
for (const f of frames) {
  const target = path.join(absDir, f);
  if (!fs.existsSync(target)) fs.copyFileSync(path.join(dir, f), target);
  bytes += fs.statSync(target).size;
}
console.log(`Copied ${(bytes / 1e6).toFixed(0)} MB to ${relDir}`);

// Same identity rule as the upload route: re-importing the same folder for the
// same student replaces it rather than stacking duplicates.
const existing = db
  .prepare("SELECT id FROM submissions WHERE assignment_id = ? AND student_id = ? AND file_name = ?")
  .get(Number(assignmentId), Number(studentId), name);

let id;
if (existing) {
  db.prepare(
    "UPDATE submissions SET file_path = ?, file_size = ?, frame_count = ?, submitted_at = datetime('now') WHERE id = ?",
  ).run(relDir, bytes, frames.length, existing.id);
  // Force a rebuild — the frame list may have changed under the same name.
  db.prepare("DELETE FROM review_media WHERE submission_id = ?").run(existing.id);
  id = existing.id;
  console.log(`Replaced submission ${id}`);
} else {
  const info = db
    .prepare(
      `INSERT INTO submissions (assignment_id, student_id, file_path, file_name, file_type, file_size, media_type, frame_count)
       VALUES (?, ?, ?, ?, 'image/x-sequence', ?, 'image', ?)`,
    )
    .run(Number(assignmentId), Number(studentId), relDir, name, bytes, frames.length);
  id = info.lastInsertRowid;
  console.log(`Created submission ${id}`);
}

console.log(`Open /assignments/${assignmentId}/review and pick ${student.name}.`);
