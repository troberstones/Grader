import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const db = new Database('storage/grader.db');

const ASSIGNMENT_ID = 2;
const SOURCE_DIR = 'testData/fast shading 2';

const files = fs.readdirSync(SOURCE_DIR).sort();

// Students to map to (first 7 of 11 enrolled)
const students = db.prepare(`
  SELECT s.id, s.name, s.sort_name
  FROM students s
  JOIN course_enrollments ce ON ce.student_id = s.id
  WHERE ce.course_id = 1
  ORDER BY s.sort_name
`).all().slice(0, 7);

console.log('Mapping files to students:');
files.forEach((file, i) => {
  const student = students[i];
  console.log(`  ${student.sort_name} (id=${student.id}) ← ${file}`);
});

// Clear any existing submissions for this assignment
db.prepare(`DELETE FROM submissions WHERE assignment_id = ?`).run(ASSIGNMENT_ID);

const insertSub = db.prepare(`
  INSERT INTO submissions (assignment_id, student_id, file_path, file_name, file_type, file_size, media_type, submitted_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
`);

for (let i = 0; i < files.length; i++) {
  const file = files[i];
  const student = students[i];
  const ext = path.extname(file).toLowerCase();

  const mediaType = ['.mp4', '.mov', '.webm', '.gif'].includes(ext) ? 'video' : 'image';
  const mimeType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';

  const destDir = `storage/submissions/${ASSIGNMENT_ID}/${student.id}`;
  fs.mkdirSync(destDir, { recursive: true });

  const destFile = path.join(destDir, file);
  fs.copyFileSync(path.join(SOURCE_DIR, file), destFile);

  const stats = fs.statSync(destFile);
  // Store as relative path from project root
  const relPath = destFile;

  insertSub.run(ASSIGNMENT_ID, student.id, relPath, file, mimeType, stats.size, mediaType);
  console.log(`  ✓ Inserted submission for ${student.sort_name}`);
}

console.log(`\nDone. ${files.length} submissions created for assignment ${ASSIGNMENT_ID}.`);
db.close();
