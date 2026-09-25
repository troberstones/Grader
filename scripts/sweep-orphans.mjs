#!/usr/bin/env node
/**
 * Finds files under storage/submissions, storage/thumbnails, and
 * storage/review that no database row points at — orphans left behind by a
 * replaced submission whose derivatives didn't get cleaned up, or a sequence
 * upload that wrote frames before its DB insert and then failed partway —
 * and DB rows that point at a file no longer on disk.
 *
 * DRY RUN BY DEFAULT: prints a report with sizes and touches nothing. Only
 * with `--delete --yes` does it remove the orphan *files* it just listed,
 * one path at a time, each re-verified to be inside the storage root before
 * it's touched. It never deletes DB rows — a dangling row is reported, never
 * removed, since the fix for "the DB thinks a file exists that doesn't" is a
 * judgment call (re-ingest? re-upload? was the disk itself the problem?),
 * not something safe to automate here.
 *
 *   node scripts/sweep-orphans.mjs
 *   node scripts/sweep-orphans.mjs --delete --yes
 *   npm run storage:sweep
 *   npm run storage:sweep -- --delete --yes
 *   DB_PATH=... node scripts/sweep-orphans.mjs
 */
import Database from "better-sqlite3";
import { readdirSync, statSync, unlinkSync, rmdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DB_PATH = process.env.DB_PATH || path.join(ROOT, "storage", "grader.db");
const STORAGE_DIRS = [
  path.join(ROOT, "storage", "submissions"),
  path.join(ROOT, "storage", "thumbnails"),
  path.join(ROOT, "storage", "review"),
];

// A file younger than this is never reported: an upload or ingest writes
// its files before inserting the row that points at them, so a sweep run
// while the app is busy would otherwise see in-progress work as orphaned.
const MIN_AGE_MS = 60 * 60 * 1000;

const doDelete = process.argv.includes("--delete");
const confirmed = process.argv.includes("--yes");

function walkFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // doesn't exist yet — nothing to sweep there
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let value = n;
  let i = -1;
  do {
    value /= 1024;
    i++;
  } while (value >= 1024 && i < units.length - 1);
  return `${value.toFixed(1)} ${units[i]}`;
}

export function findOrphans({ dbPath = DB_PATH, storageDirs = STORAGE_DIRS, root = ROOT, minAgeMs = MIN_AGE_MS } = {}) {
  const toRel = (absPath) => path.relative(root, absPath);
  const db = new Database(dbPath);
  try {
    const subs = db.prepare("SELECT id, file_path, thumbnail_path FROM submissions").all();
    const media = db.prepare("SELECT id, path FROM review_media").all();

    // Direct file references, plus (for a sequence submission) the directory
    // its filePath names — everything under that directory is its frames,
    // none of them individually recorded as their own row.
    const knownFiles = new Set();
    const knownDirs = [];

    for (const s of subs) {
      if (s.file_path) {
        const abs = path.join(root, s.file_path);
        try {
          if (statSync(abs).isDirectory()) knownDirs.push(s.file_path);
          else knownFiles.add(s.file_path);
        } catch {
          // Missing on disk — reported below as a dangling row, not scanned as known.
        }
      }
      if (s.thumbnail_path) knownFiles.add(s.thumbnail_path);
    }
    for (const m of media) {
      if (m.path) knownFiles.add(m.path);
    }

    function isKnown(rel) {
      if (knownFiles.has(rel)) return true;
      return knownDirs.some((d) => rel === d || rel.startsWith(d + path.sep));
    }

    const orphanFiles = [];
    for (const dir of storageDirs) {
      for (const abs of walkFiles(dir)) {
        const rel = toRel(abs);
        if (isKnown(rel)) continue;
        const st = statSync(abs);
        if (Date.now() - st.mtimeMs < minAgeMs) continue;
        orphanFiles.push({ abs, rel, size: st.size });
      }
    }

    const danglingRows = [];
    for (const s of subs) {
      if (!s.file_path) continue;
      try {
        statSync(path.join(root, s.file_path));
      } catch {
        danglingRows.push({ table: "submissions", id: s.id, path: s.file_path });
      }
    }
    for (const m of media) {
      if (!m.path) continue;
      try {
        statSync(path.join(root, m.path));
      } catch {
        danglingRows.push({ table: "review_media", id: m.id, path: m.path });
      }
    }

    return { orphanFiles, danglingRows };
  } finally {
    db.close();
  }
}

/** Deletes exactly the listed orphan files (each re-verified inside `storageDirs`), then rmdir()s any directory left empty — never a recursive/force remove. Returns { removed, freed }. */
export function deleteOrphans(orphanFiles, { storageDirs = STORAGE_DIRS } = {}) {
  let removed = 0;
  let freed = 0;
  const touchedDirs = new Set();

  for (const f of orphanFiles) {
    const resolved = path.resolve(f.abs);
    const inside = storageDirs.some((root) => resolved === root || resolved.startsWith(root + path.sep));
    if (!inside) {
      console.error(`Refusing to delete path outside storage root: ${f.abs}`);
      continue;
    }
    try {
      unlinkSync(resolved);
      removed++;
      freed += f.size;
      touchedDirs.add(path.dirname(resolved));
    } catch (err) {
      console.error(`Failed to delete ${f.rel}: ${err.message}`);
    }
  }

  // Deepest first, so a now-empty child directory clears before its parent
  // is checked. rmdir refuses a non-empty directory, so this can never
  // remove anything that still has content.
  for (const dir of [...touchedDirs].sort((a, b) => b.length - a.length)) {
    const resolved = path.resolve(dir);
    const inside = storageDirs.some((root) => resolved === root || resolved.startsWith(root + path.sep));
    if (!inside) continue;
    try {
      rmdirSync(resolved);
    } catch {
      // Not empty, or already gone — leave it.
    }
  }

  return { removed, freed };
}

async function main() {
  const { orphanFiles, danglingRows } = findOrphans();
  const totalBytes = orphanFiles.reduce((sum, f) => sum + f.size, 0);

  console.log(`Storage sweep — ${DB_PATH}`);
  console.log("");
  if (orphanFiles.length === 0) {
    console.log("No orphan files found.");
  } else {
    console.log(`${orphanFiles.length} orphan file(s), ${formatBytes(totalBytes)}:`);
    for (const f of orphanFiles) console.log(`  ${f.rel}  (${formatBytes(f.size)})`);
  }

  console.log("");
  if (danglingRows.length === 0) {
    console.log("No dangling DB rows found.");
  } else {
    console.log(`${danglingRows.length} DB row(s) point at a missing file (reported only — never deleted):`);
    for (const r of danglingRows) console.log(`  ${r.table}#${r.id} -> ${r.path}`);
  }

  if (!doDelete) {
    console.log("");
    console.log("Dry run — nothing was deleted. Re-run with --delete --yes to remove the orphan files listed above.");
    return;
  }

  if (!confirmed) {
    console.error("");
    console.error("--delete requires --yes to actually remove files.");
    process.exitCode = 1;
    return;
  }

  const { removed, freed } = deleteOrphans(orphanFiles);
  console.log("");
  console.log(`Deleted ${removed} file(s), freed ${formatBytes(freed)}.`);
}

// Only run when invoked directly — importable for tests otherwise.
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
