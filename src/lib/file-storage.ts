import path from "path";
import fs from "fs/promises";
import { SUBMISSIONS_DIR, THUMBNAILS_DIR, SUPPORTED_EXTENSIONS, classifyMediaType } from "./constants";

// Mirrors REVIEW_DIR in src/actions/review.ts (art-review derivatives are
// written to storage/review/{assignmentId}/{studentId}/…, same layout as
// submissions/thumbnails below). Kept as a local literal rather than an
// import so this file's only reason to change stays "storage layout".
const REVIEW_DIR = "storage/review";

export function getSubmissionDir(assignmentId: number, studentId: number): string {
  return path.join(process.cwd(), SUBMISSIONS_DIR, String(assignmentId), String(studentId));
}

export function getThumbnailDir(assignmentId: number, studentId: number): string {
  return path.join(process.cwd(), THUMBNAILS_DIR, String(assignmentId), String(studentId));
}

/**
 * Removes every on-disk file for an assignment: original submissions,
 * thumbnails, and art-review derivatives (proxies/posters/composites), all of
 * which are laid out as `<root>/{assignmentId}/...`. Called after the DB rows
 * for that assignment are already gone (deleteAssignment / deleteCourse in
 * src/actions), so a failure here never leaves the database and disk
 * disagreeing about whether the assignment still "exists" — it just leaves
 * some orphaned bytes on disk, which is why this logs instead of throwing.
 */
export async function removeAssignmentStorage(assignmentId: number): Promise<void> {
  const dirs = [
    path.join(process.cwd(), SUBMISSIONS_DIR, String(assignmentId)),
    path.join(process.cwd(), THUMBNAILS_DIR, String(assignmentId)),
    path.join(process.cwd(), REVIEW_DIR, String(assignmentId)),
  ];
  for (const dir of dirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err) {
      console.error(`[removeAssignmentStorage] failed to remove ${dir}:`, err);
    }
  }
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export function getMediaType(fileName: string): "image" | "video" | null {
  return classifyMediaType(fileName);
}

export function getMimeType(fileName: string): string | null {
  const ext = path.extname(fileName).toLowerCase();
  return SUPPORTED_EXTENSIONS[ext] || null;
}
