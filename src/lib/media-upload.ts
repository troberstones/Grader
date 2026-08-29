"use client";

import { SEQUENCE_FRAME_EXTENSIONS } from "./constants";

/**
 * Posted to a Route Handler rather than called as a Server Action — Next's
 * Server Actions body parser only honors the configured size limit for
 * individual FormData field values, not the request as a whole, so a
 * multi-frame sequence (or any file over ~10MB) fails outright. See the
 * comment on the route itself.
 */
async function postFormData(fd: FormData): Promise<number> {
  const res = await fetch("/api/submissions/direct-upload", { method: "POST", body: fd });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Upload failed (${res.status}).`);
  return body.submissionId as number;
}

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
 * Classifies a dropped/picked batch and posts it to the right shape — one
 * shared sequence-vs-separate-pieces decision for every upload surface (the
 * empty-state drop zone, the "+ Add" control on an existing playlist).
 *
 * Returns the id of every submission row created, in upload order, so a
 * caller can subscribe to /api/review/ingest-progress/{id} and keep showing
 * something after the upload itself finishes — the transcode that follows
 * is the slow part for video and otherwise looks identical to a stall.
 */
export async function uploadFiles(
  assignmentId: number,
  studentId: number,
  files: File[],
  onProgress?: (label: string) => void,
): Promise<number[]> {
  if (files.length === 0) return [];

  if (isOneSequence(files)) {
    onProgress?.(`Uploading ${files.length} frames…`);
    const fd = new FormData();
    fd.append("assignmentId", String(assignmentId));
    fd.append("studentId", String(studentId));
    for (const f of files) fd.append("files", f);
    return [await postFormData(fd)];
  }

  const submissionIds: number[] = [];
  for (let i = 0; i < files.length; i++) {
    onProgress?.(files.length > 1 ? `Uploading ${i + 1} of ${files.length}…` : "Uploading…");
    const fd = new FormData();
    fd.append("assignmentId", String(assignmentId));
    fd.append("studentId", String(studentId));
    fd.append("file", files[i]);
    submissionIds.push(await postFormData(fd));
  }
  return submissionIds;
}
