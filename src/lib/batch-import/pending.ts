import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";

import { STORAGE_DIR } from "@/lib/constants";

/**
 * Files from a batch zip that no student could be matched to, kept until the
 * instructor picks whose they are. The zip itself is gone once the upload
 * request ends (it can be several GB), so each unmatched file is copied out
 * here under a random token: storage/batch-pending/<assignmentId>/<token>/<name>.
 *
 * Nothing in the database points at these. Anything not assigned within
 * PENDING_TTL_MS is swept on the next zip upload.
 */
const PENDING_DIR = path.join(STORAGE_DIR, "batch-pending");
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function assignmentDir(assignmentId: number) {
  return path.join(process.cwd(), PENDING_DIR, String(assignmentId));
}

export async function stagePending(
  assignmentId: number,
  name: string,
  write: (absolutePath: string) => Promise<void>,
): Promise<string> {
  const token = randomUUID();
  const dir = path.join(assignmentDir(assignmentId), token);
  await fs.mkdir(dir, { recursive: true });
  await write(path.join(dir, path.basename(name)));
  return token;
}

/** The staged file for `token`, or null if it was already assigned, swept, or the token is bogus. */
export async function readPending(
  assignmentId: number,
  token: string,
): Promise<{ abs: string; name: string; size: number } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const dir = path.join(assignmentDir(assignmentId), token);
  try {
    const [name] = await fs.readdir(dir);
    if (!name) return null;
    const abs = path.join(dir, name);
    return { abs, name, size: (await fs.stat(abs)).size };
  } catch {
    return null;
  }
}

export async function removePending(assignmentId: number, token: string): Promise<void> {
  if (!TOKEN_RE.test(token)) return;
  await fs.rm(path.join(assignmentDir(assignmentId), token), { recursive: true, force: true });
}

/** Drop staged files older than PENDING_TTL_MS, across all assignments. Never throws. */
export async function sweepPending(): Promise<void> {
  const root = path.join(process.cwd(), PENDING_DIR);
  const cutoff = Date.now() - PENDING_TTL_MS;
  try {
    for (const aid of await fs.readdir(root)) {
      const aDir = path.join(root, aid);
      for (const token of await fs.readdir(aDir).catch(() => [] as string[])) {
        if (!TOKEN_RE.test(token)) continue;
        const dir = path.join(aDir, token);
        const stat = await fs.stat(dir).catch(() => null);
        if (stat && stat.mtimeMs < cutoff) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }
  } catch {
    // No pending dir yet.
  }
}
