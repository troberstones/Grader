import path from "path";
import fs from "fs/promises";
import { SUBMISSIONS_DIR, THUMBNAILS_DIR, SUPPORTED_EXTENSIONS, classifyMediaType } from "./constants";

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
  return classifyMediaType(fileName);
}

export function getMimeType(fileName: string): string | null {
  const ext = path.extname(fileName).toLowerCase();
  return SUPPORTED_EXTENSIONS[ext] || null;
}
