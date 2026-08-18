"use client";

import { SEQUENCE_FRAME_EXTENSIONS } from "./constants";
import { uploadSubmission, uploadSubmissionSequence } from "@/actions/submissions";

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

/** Frames sharing a name + trailing frame number belong to one sequence — "shot_0001.png" -> "shot_". */
function sequencePrefix(name: string): string | null {
  const ext = extOf(name);
  if (!SEQUENCE_FRAME_EXTENSIONS.has(ext)) return null;
  const base = name.slice(0, name.length - ext.length);
  const m = base.match(/^(.*?)(\d+)$/);
  return m ? m[1] : null;
}

/** Multiple files only read as one sequence when every one is a frame and they share a prefix. */
function isOneSequence(files: File[]): boolean {
  if (files.length < 2) return false;
  const prefixes = files.map((f) => sequencePrefix(f.name));
  if (prefixes.some((p) => p === null)) return false;
  return new Set(prefixes).size === 1;
}

/**
 * Classifies a dropped/picked batch and writes it via the right server
 * action(s) — one shared sequence-vs-separate-pieces decision for every
 * upload surface (the empty-state drop zone, the "+ Add" control on an
 * existing playlist).
 */
export async function uploadFiles(
  assignmentId: number,
  studentId: number,
  files: File[],
  onProgress?: (label: string) => void,
): Promise<void> {
  if (files.length === 0) return;

  if (isOneSequence(files)) {
    onProgress?.(`Uploading ${files.length} frames…`);
    const fd = new FormData();
    fd.append("assignmentId", String(assignmentId));
    fd.append("studentId", String(studentId));
    for (const f of files) fd.append("files", f);
    await uploadSubmissionSequence(fd);
    return;
  }

  for (let i = 0; i < files.length; i++) {
    onProgress?.(files.length > 1 ? `Uploading ${i + 1} of ${files.length}…` : "Uploading…");
    const fd = new FormData();
    fd.append("assignmentId", String(assignmentId));
    fd.append("studentId", String(studentId));
    fd.append("file", files[i]);
    await uploadSubmission(fd);
  }
}
