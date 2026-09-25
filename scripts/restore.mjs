#!/usr/bin/env node
/**
 * Restores a backup set produced by scripts/backup.mjs into a TARGET
 * directory laid out like the app dir (TARGET/storage/grader.db,
 * TARGET/storage/submissions/, TARGET/.env, ...). Defaults to a fresh temp
 * directory — restoring over the live app is refused unless you explicitly
 * ask for it, because that's exactly what a fat-fingered `--dest` typo
 * during a real incident should not be able to do by accident.
 *
 *   node scripts/restore.mjs --dest /mnt/backup/grader --verify
 *   node scripts/restore.mjs --dest /mnt/backup/grader --snapshot grader-2026-09-24-033000.db --into /tmp/inspect
 *   node scripts/restore.mjs --dest /mnt/backup/grader --into-live --yes --confirm-service-stopped
 *
 * `--verify` restores into a temp dir, runs `PRAGMA integrity_check`, counts
 * rows in the key tables, confirms every submission's file exists, and
 * prints a report — this is the "tested restore" docs/operations.md talks
 * about. It never touches the live app dir.
 */
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import {
  MEDIA_DIRS,
  CONFIG_FILES,
  CONFIG_DIRS,
  assertSafeDirectory,
  fetchFile,
  listDbSnapshots,
  listDir,
  maybeDecryptFile,
  pullDir,
  mkTempDir,
  commandExists,
} from "./lib/backup-set.mjs";

const KEY_TABLES = ["users", "courses", "students", "assignments", "submissions", "grades", "rubrics"];

function parseArgs(argv) {
  const args = { snapshot: "latest" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dest") args.dest = argv[++i];
    else if (a === "--snapshot") args.snapshot = argv[++i];
    else if (a === "--into") args.into = argv[++i];
    else if (a === "--into-live") args.intoLive = true;
    else if (a === "--yes") args.yes = true;
    else if (a === "--confirm-service-stopped") args.confirmServiceStopped = true;
    else if (a === "--verify") args.verify = true;
    else throw new Error(`unrecognized argument: ${a}`);
  }
  return args;
}

function resolveSnapshotName(dest, requested) {
  const all = listDbSnapshots(dest);
  if (all.length === 0) throw new Error(`no DB snapshots found under ${dest}/db`);
  if (requested === "latest") return all[all.length - 1];
  const match = all.find((f) => f === requested || f === `${requested}.age` || f === `${requested}.gpg`);
  if (!match) {
    throw new Error(`snapshot "${requested}" not found. Available:\n  ${all.join("\n  ")}`);
  }
  return match;
}

function isLiveServiceActive() {
  if (!commandExists("systemctl")) return null; // can't tell — caller decides how to treat that
  const result = spawnSync("systemctl", ["--user", "is-active", "grader.service"], { encoding: "utf8" });
  return result.stdout.trim() === "active";
}

/**
 * Restores one backup set into `target`. Returns a report object; throws on
 * anything that should stop the process (bad args, missing snapshot, unsafe
 * target). Verification failures are reported, not thrown — a failed
 * verify is a successful *run* of the drill that found a problem.
 */
export async function runRestore(rawArgs, env = process.env) {
  const args = parseArgs(rawArgs);
  const dest = args.dest || env.BACKUP_DEST;
  if (!dest) throw new Error("no destination given — pass --dest or set BACKUP_DEST");

  const appDir = env.APP_DIR || process.cwd();
  let target;
  if (args.intoLive) {
    if (!args.yes || !args.confirmServiceStopped) {
      throw new Error(
        "--into-live requires both --yes and --confirm-service-stopped (stop grader.service first: " +
          "`systemctl --user stop grader.service`) — refusing to overwrite the live app directory otherwise.",
      );
    }
    const active = isLiveServiceActive();
    if (active === true) {
      throw new Error("grader.service is still active (systemctl --user is-active) — stop it before restoring into the live dir.");
    }
    target = appDir;
  } else {
    target = args.into || mkTempDir("grader-restore-");
    target = assertSafeDirectory(target, { appDir });
    mkdirSync(target, { recursive: true });
  }

  const snapshotName = resolveSnapshotName(dest, args.snapshot);
  const stagingDir = mkTempDir("grader-restore-stage-");
  try {
    const staged = path.join(stagingDir, snapshotName);
    fetchFile(dest, `db/${snapshotName}`, staged);
    const dbTarget = path.join(target, "storage", "grader.db");
    mkdirSync(path.dirname(dbTarget), { recursive: true });
    maybeDecryptFile(staged, dbTarget);

    for (const name of MEDIA_DIRS) {
      pullDir(dest, `media/${name}`, path.join(target, "storage", name));
    }

    for (const base of CONFIG_FILES) {
      const candidates = listDir(dest, "config").filter((f) => f === base || f === `${base}.age` || f === `${base}.gpg`);
      if (candidates.length === 0) continue;
      const staged2 = path.join(stagingDir, candidates[0]);
      fetchFile(dest, `config/${candidates[0]}`, staged2);
      maybeDecryptFile(staged2, path.join(target, base));
    }
    for (const name of CONFIG_DIRS) {
      pullDir(dest, `config/${name}`, path.join(target, name));
    }

    const report = { dest, snapshot: snapshotName, target, verify: null };

    if (args.verify) {
      report.verify = verifyRestoredDb(dbTarget, target);
    }

    printReport(report);
    return report;
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

export function verifyRestoredDb(dbPath, appRoot) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const integrity = db.pragma("integrity_check", { simple: true });
    const tableNames = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
    );
    const counts = {};
    for (const table of KEY_TABLES) {
      counts[table] = tableNames.has(table) ? db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n : null;
    }

    let missingFiles = [];
    if (tableNames.has("submissions")) {
      const rows = db.prepare("SELECT id, file_path, thumbnail_path FROM submissions").all();
      for (const row of rows) {
        for (const rel of [row.file_path, row.thumbnail_path]) {
          if (!rel) continue;
          if (!existsSync(path.join(appRoot, rel))) {
            missingFiles.push({ submissionId: row.id, path: rel });
          }
        }
      }
    }

    const ok = integrity === "ok" && missingFiles.length === 0;
    return { ok, integrity, counts, missingFiles };
  } finally {
    db.close();
  }
}

function printReport(report) {
  console.log(`Restored ${report.snapshot} from ${report.dest} into ${report.target}`);
  if (!report.verify) return;
  const v = report.verify;
  console.log(`  integrity_check: ${v.integrity}`);
  for (const [table, count] of Object.entries(v.counts)) {
    console.log(`  ${table.padEnd(12)} ${count === null ? "(no such table)" : `${count} row(s)`}`);
  }
  if (v.missingFiles.length > 0) {
    console.log(`  MISSING ${v.missingFiles.length} referenced file(s):`);
    for (const m of v.missingFiles.slice(0, 20)) console.log(`    submission ${m.submissionId}: ${m.path}`);
    if (v.missingFiles.length > 20) console.log(`    ... and ${v.missingFiles.length - 20} more`);
  }
  console.log(`  RESULT: ${v.ok ? "PASS" : "FAIL"}`);
}

export async function main() {
  try {
    const report = await runRestore(process.argv.slice(2), process.env);
    if (report.verify && !report.verify.ok) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`Restore failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
