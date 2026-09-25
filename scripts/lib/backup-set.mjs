// Shared plumbing for scripts/backup.mjs and scripts/restore.mjs — the
// on-disk layout of a "backup set", moving bytes to/from a destination
// (local path or `user@host:/path` rsync target), and the safety guards
// both scripts lean on before deleting or overwriting anything.
//
// Layout under BACKUP_DEST (see docs/operations.md "Backup & restore" for
// the full design writeup):
//
//   <dest>/db/grader-<stamp>.db[.age|.gpg]   dated snapshots, VACUUM INTO
//   <dest>/media/{submissions,review,thumbnails}/   rsync mirror (current state)
//   <dest>/config/{.env,.env.local,certs/}[.age|.gpg for the small files]
//   <dest>/attic/<stamp>/{media,config}/...   files the <stamp> run deleted
//                                             or overwrote in the mirror
//   <dest>/status.json                        last run's outcome
//
// Media is a plain rsync mirror rather than a dated/hardlinked tree: rsync
// already only transfers what changed, so "incremental" is free, and a
// mirror is far simpler to reason about and restore than a --link-dest farm
// of per-night hardlinks. A bare `--delete` mirror would also faithfully
// copy a disaster — uploads wiped or overwritten on the server would vanish
// from the backup the next night — so every mirror run passes
// `--backup --backup-dir=<dest>/attic/<stamp>/...`: anything the run would
// delete or overwrite is moved into that night's attic instead. Attic
// nights are pruned alongside the DB snapshots they sit next to.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  unlinkSync,
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
  renameSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

/** storage/ subdirectories treated as "uploads" worth backing up. Deliberately
 * excludes storage/rubrics and storage/exports — grep shows nothing in src/
 * writes real content there today; add them here if that changes. */
export const MEDIA_DIRS = ["submissions", "review", "thumbnails"];

/** Config files/dirs, relative to the app directory. */
export const CONFIG_FILES = [".env", ".env.local"];
export const CONFIG_DIRS = ["certs"];

export const DB_SNAPSHOT_RE = /^grader-\d{4}-\d{2}-\d{2}-\d{6}\.db(\.age|\.gpg)?$/;
export const STAMP_RE = /^\d{4}-\d{2}-\d{2}-\d{6}$/;

export function timestamp(date = new Date()) {
  // grader-YYYY-MM-DD-HHMMSS, sortable and matches the existing filename
  // pattern backup-db.mjs already used (grader-<stamp>.db).
  const iso = date.toISOString(); // 2026-09-25T03:30:00.000Z
  const day = iso.slice(0, 10);
  const time = iso.slice(11, 19).replace(/:/g, "");
  return `${day}-${time}`;
}

/** `user@host:/path` — the only remote form rsync/ssh accept, and the only
 * one this repo needs (the deploy host is Linux, never a Windows path). */
export function isRemoteDest(dest) {
  return /^[^\s/]+@[^\s:]+:.+/.test(dest);
}

export function splitRemote(dest) {
  const idx = dest.indexOf(":");
  return { host: dest.slice(0, idx), remotePath: dest.slice(idx + 1) };
}

/**
 * Guards shared by every destructive or overwrite-prone path: pruning old
 * snapshots and `restore --into-live`. Throws with a clear reason instead of
 * returning a boolean, so callers can't accidentally ignore it.
 */
export function assertSafeDirectory(p, { appDir } = {}) {
  if (!p || `${p}`.trim() === "") {
    throw new Error("refusing to operate on an empty/unset destination path");
  }
  const resolved = path.resolve(p);
  if (resolved === path.parse(resolved).root) {
    throw new Error(`refusing to operate on a filesystem root: ${resolved}`);
  }
  if (appDir && resolved === path.resolve(appDir)) {
    throw new Error(`refusing to operate on the app directory itself: ${resolved}`);
  }
  return resolved;
}

function run(cmd, args, { input } = {}) {
  const result = spawnSync(cmd, args, { input, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${result.status}: ${(result.stderr || "").trim()}`);
  }
  return result.stdout;
}

export function commandExists(cmd) {
  const result = spawnSync("which", [cmd], { encoding: "utf8" });
  return result.status === 0;
}

// ── DB snapshot ─────────────────────────────────────────────────────────

/** `VACUUM INTO` a fresh, self-contained snapshot — safe under WAL, and the
 * one part of a backup that must never be a plain file copy (the -wal file
 * can hold committed data the main file doesn't have yet). */
export function vacuumSnapshot(dbPath, destFile) {
  mkdirSync(path.dirname(destFile), { recursive: true });
  const db = new Database(dbPath, { readonly: true });
  try {
    db.pragma("busy_timeout = 5000");
    db.exec(`VACUUM INTO '${destFile.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  return destFile;
}

// ── Optional encryption (age preferred, gpg fallback) ───────────────────

/** Encrypts a single small file in place-ish (writes `<file>.age`/`.gpg`
 * next to it and removes the plaintext). Returns the new path, or the
 * original path unchanged if no recipient is configured or neither `age`
 * nor `gpg` is installed (a loud warning is logged either way). */
export function maybeEncryptFile(filePath, recipient, log = console.error) {
  if (!recipient) return filePath;
  if (commandExists("age")) {
    const out = `${filePath}.age`;
    run("age", ["-r", recipient, "-o", out, filePath]);
    unlinkSync(filePath);
    return out;
  }
  if (commandExists("gpg")) {
    const out = `${filePath}.gpg`;
    run("gpg", ["--batch", "--yes", "--trust-model", "always", "--recipient", recipient, "--output", out, "--encrypt", filePath]);
    unlinkSync(filePath);
    return out;
  }
  log(
    `[backup] BACKUP_ENCRYPT_RECIPIENT is set but neither 'age' nor 'gpg' is installed — ` +
      `leaving ${filePath} unencrypted. Install one of them or drop the setting.`,
  );
  return filePath;
}

export function maybeDecryptFile(filePath, destPath) {
  if (filePath.endsWith(".age")) {
    if (!commandExists("age")) throw new Error(`${filePath} is age-encrypted but 'age' isn't installed`);
    run("age", ["--decrypt", "-o", destPath, filePath]);
    return destPath;
  }
  if (filePath.endsWith(".gpg")) {
    if (!commandExists("gpg")) throw new Error(`${filePath} is gpg-encrypted but 'gpg' isn't installed`);
    run("gpg", ["--batch", "--yes", "--output", destPath, "--decrypt", filePath]);
    return destPath;
  }
  cpSync(filePath, destPath);
  return destPath;
}

// ── rsync helpers (local dest or user@host:/path) ───────────────────────

/** rsync flags that move anything about to be deleted or overwritten into
 * `backupDir` on the receiving side (absolute, so rsync doesn't resolve it
 * against the destination directory). Remote destinations only: the deploy
 * host's GNU rsync honors these, but macOS's bundled openrsync silently
 * skips every deletion when --backup-dir is combined with --delete, so local
 * destinations use stashChangedFiles() instead, which doesn't depend on
 * which rsync is installed. */
function atticFlags(backupDir) {
  if (!backupDir) return [];
  return ["--backup", `--backup-dir=${splitRemote(backupDir).remotePath}`];
}

/**
 * Local-destination attic: before the mirror runs, move every file in
 * `destDir` that the mirror is about to delete (gone from `srcDir`) or
 * overwrite (size or mtime differs — rsync's own quick check) into
 * `atticDir`, keeping its relative path. rename() only — the attic lives
 * under the same destination, so nothing is copied or removed here.
 */
function stashChangedFiles(srcDir, destDir, atticDir) {
  const walk = (rel) => {
    let entries;
    try {
      entries = readdirSync(path.join(destDir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = path.join(rel, entry.name);
      if (entry.isDirectory()) {
        walk(childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      const destFile = path.join(destDir, childRel);
      let changed = true;
      try {
        const a = statSync(path.join(srcDir, childRel));
        const b = statSync(destFile);
        changed = !a.isFile() || a.size !== b.size || Math.floor(a.mtimeMs / 1000) !== Math.floor(b.mtimeMs / 1000);
      } catch {
        // Gone from the source — the mirror would delete it.
      }
      if (!changed) continue;
      const atticFile = path.join(atticDir, childRel);
      mkdirSync(path.dirname(atticFile), { recursive: true });
      renameSync(destFile, atticFile);
    }
  };
  walk("");
}

/** Mirrors `srcDir` (must exist locally) into `dest` (`localDir` or
 * `user@host:/remoteDir`), removing anything at the destination that's gone
 * from the source — into `opts.backupDir` when given (see the attic note at
 * the top of this file), which every backup run passes. No-ops (with a
 * note) when srcDir doesn't exist yet — a brand-new install may not have
 * created storage/review/ yet, say. */
export function rsyncMirror(srcDir, dest, log = console.log, { backupDir } = {}) {
  if (!existsSync(srcDir)) {
    log(`[backup] ${srcDir} doesn't exist yet — skipping.`);
    return;
  }
  const from = srcDir.endsWith("/") ? srcDir : `${srcDir}/`;
  if (isRemoteDest(dest)) {
    const { host, remotePath } = splitRemote(dest);
    run("ssh", [host, "mkdir", "-p", remotePath]);
    run("rsync", ["-a", "--delete", ...atticFlags(backupDir), "-e", "ssh", from, `${host}:${remotePath}/`]);
  } else {
    mkdirSync(dest, { recursive: true });
    if (backupDir) stashChangedFiles(srcDir, dest, backupDir);
    run("rsync", ["-a", "--delete", from, `${dest}/`]);
  }
}

/** Ships a single local file to `dest` (local dir, or `user@host:/dir`); a
 * file it replaces goes to `opts.backupDir` when given. */
export function shipFile(localFile, dest, { backupDir } = {}) {
  if (isRemoteDest(dest)) {
    const { host, remotePath } = splitRemote(dest);
    run("ssh", [host, "mkdir", "-p", remotePath]);
    run("rsync", ["-a", ...atticFlags(backupDir), "-e", "ssh", localFile, `${host}:${remotePath}/`]);
  } else {
    mkdirSync(dest, { recursive: true });
    const existing = path.join(dest, path.basename(localFile));
    if (backupDir && existsSync(existing)) {
      mkdirSync(backupDir, { recursive: true });
      renameSync(existing, path.join(backupDir, path.basename(localFile)));
    }
    run("rsync", ["-a", localFile, `${dest}/`]);
  }
}

/** Pulls a single remote file down to `localFile`, or just copies it if
 * `dest` is already local. */
export function fetchFile(destDir, name, localFile) {
  mkdirSync(path.dirname(localFile), { recursive: true });
  if (isRemoteDest(destDir)) {
    const { host, remotePath } = splitRemote(destDir);
    run("rsync", ["-a", "-e", "ssh", `${host}:${remotePath}/${name}`, localFile]);
  } else {
    cpSync(path.join(destDir, name), localFile);
  }
}

/** Lists file names directly inside a destination's `db/` directory. */
export function listDbSnapshots(destDir) {
  if (isRemoteDest(destDir)) {
    const { host, remotePath } = splitRemote(destDir);
    const result = spawnSync("ssh", [host, `ls -1 ${JSON.stringify(`${remotePath}/db`)} 2>/dev/null`], {
      encoding: "utf8",
    });
    if (result.status !== 0) return [];
    return result.stdout.split("\n").filter((f) => DB_SNAPSHOT_RE.test(f)).sort();
  }
  const dir = path.join(destDir, "db");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => DB_SNAPSHOT_RE.test(f)).sort();
}

/** Deletes every db/ snapshot except the newest `keep`. Only ever touches
 * files matching DB_SNAPSHOT_RE, inside a directory that passed
 * assertSafeDirectory — never a bare `rm -rf` of the destination. */
export function pruneDbSnapshots(destDir, keep, log = console.log) {
  const all = listDbSnapshots(destDir);
  const toDelete = all.slice(0, Math.max(0, all.length - keep));
  if (toDelete.length === 0) return 0;
  if (isRemoteDest(destDir)) {
    const { host, remotePath } = splitRemote(destDir);
    assertSafeDirectory(remotePath); // best-effort shape check; real guard is the regex filter above
    for (const name of toDelete) {
      run("ssh", [host, "rm", "-f", `${remotePath}/db/${name}`]);
    }
  } else {
    const dir = assertSafeDirectory(path.join(destDir, "db"));
    for (const name of toDelete) {
      unlinkSync(path.join(dir, name));
    }
  }
  log(`[backup] pruned ${toDelete.length} old DB snapshot(s), kept ${Math.min(keep, all.length)}.`);
  return toDelete.length;
}

/** The stamp part of a DB snapshot name (`grader-<stamp>.db[.age|.gpg]`). */
export function snapshotStamp(name) {
  return name.slice("grader-".length, "grader-".length + 17);
}

/**
 * Removes attic nights older than the oldest DB snapshot still kept, so the
 * attic never outlives the snapshots it pairs with. Only ever removes an
 * entry directly under `<dest>/attic` whose name is exactly a run stamp —
 * the same shape guard pruneDbSnapshots relies on — and never the attic
 * directory itself or anything outside it.
 */
export function pruneAttic(destDir, log = console.log) {
  const kept = listDbSnapshots(destDir);
  if (kept.length === 0) return 0;
  const oldestKept = snapshotStamp(kept[0]);
  const stale = listDir(destDir, "attic").filter((name) => STAMP_RE.test(name) && name < oldestKept);
  if (stale.length === 0) return 0;
  if (isRemoteDest(destDir)) {
    const { host, remotePath } = splitRemote(destDir);
    assertSafeDirectory(remotePath);
    for (const name of stale) {
      run("ssh", [host, "rm", "-rf", "--", `${remotePath}/attic/${name}`]);
    }
  } else {
    const atticDir = assertSafeDirectory(path.join(destDir, "attic"));
    for (const name of stale) {
      rmSync(path.join(atticDir, name), { recursive: true, force: true });
    }
  }
  log(`[backup] pruned ${stale.length} attic night(s) older than ${oldestKept}.`);
  return stale.length;
}

// ── status file ──────────────────────────────────────────────────────────

export function writeStatus(destDir, status) {
  const payload = JSON.stringify({ ...status, writtenAt: new Date().toISOString() }, null, 2) + "\n";
  if (isRemoteDest(destDir)) {
    const tmp = path.join(mkdtempSync(path.join(tmpdir(), "grader-backup-status-")), "status.json");
    writeFileSync(tmp, payload);
    shipFile(tmp, destDir);
  } else {
    mkdirSync(destDir, { recursive: true });
    writeFileSync(path.join(destDir, "status.json"), payload);
  }
}

export function readStatus(destDir) {
  const tmp = path.join(mkdtempSync(path.join(tmpdir(), "grader-backup-status-")), "status.json");
  try {
    fetchFile(destDir, "status.json", tmp);
    return JSON.parse(readFileSync(tmp, "utf8"));
  } catch {
    return null;
  }
}

export function mkTempDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

// ── pulling a backup set back down (restore.mjs) ─────────────────────────

/** Lists file names directly inside `<destDir>/<subpath>` (non-recursive). */
export function listDir(destDir, subpath) {
  if (isRemoteDest(destDir)) {
    const { host, remotePath } = splitRemote(destDir);
    const result = spawnSync("ssh", [host, `ls -1 ${JSON.stringify(`${remotePath}/${subpath}`)} 2>/dev/null`], {
      encoding: "utf8",
    });
    if (result.status !== 0) return [];
    return result.stdout.split("\n").filter(Boolean).sort();
  }
  const dir = path.join(destDir, subpath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort();
}

/** Mirrors `<destDir>/<subpath>/` down into a local directory — the inverse
 * of rsyncMirror, used by restore.mjs to pull media/config back down. */
export function pullDir(destDir, subpath, localDir) {
  mkdirSync(localDir, { recursive: true });
  if (isRemoteDest(destDir)) {
    const { host, remotePath } = splitRemote(destDir);
    const src = `${host}:${remotePath}/${subpath}`;
    // Nothing to pull if the remote side never created this subdir; rsync
    // would otherwise fail loudly on a missing source.
    const check = spawnSync("ssh", [host, "test", "-d", `${remotePath}/${subpath}`]);
    if (check.status !== 0) return;
    run("rsync", ["-a", "--delete", "-e", "ssh", `${src}/`, `${localDir}/`]);
  } else {
    const src = path.join(destDir, subpath);
    if (!existsSync(src)) return;
    run("rsync", ["-a", "--delete", `${src}/`, `${localDir}/`]);
  }
}
