import path from "path";
import fs from "fs/promises";
import { SUBMISSIONS_DIR, THUMBNAILS_DIR, SUPPORTED_EXTENSIONS } from "./constants";

export function getSubmissionDir(assignmentId: number, studentId: number): string {
  return path.join(process.cwd(), SUBMISSIONS_DIR, String(assignmentId), String(studentId));
}

export function getThumbnailDir(assignmentId: number, studentId: number): string {
  return path.join(process.cwd(), THUMBNAILS_DIR, String(assignmentId), String(studentId));
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export function getMediaType(fileName: string): "image" | "video" | null {
  const ext = path.extname(fileName).toLowerCase();
  const mime = SUPPORTED_EXTENSIONS[ext];
  if (!mime) return null;
  return mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : null;
}

export function getMimeType(fileName: string): string | null {
  const ext = path.extname(fileName).toLowerCase();
  return SUPPORTED_EXTENSIONS[ext] || null;
}
