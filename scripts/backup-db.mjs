#!/usr/bin/env node
/**
 * Backs up storage/grader.db with SQLite's VACUUM INTO — the same technique
 * already used for the manual pre-migration snapshots in storage/ (e.g.
 * grader-2026-08-14-pre-v2.db) — into a timestamped file under
 * storage/backups/, then prunes backups older than RETENTION_DAYS.
 *
 * Meant to run on a schedule (see scripts/systemd/grader-backup.{service,timer}),
 * but safe to run by hand too:
 *
 *   node scripts/backup-db.mjs
 *   DB_PATH=... BACKUP_DIR=... RETENTION_DAYS=... node scripts/backup-db.mjs
 */
import Database from "better-sqlite3";
import { readdirSync, statSync, unlinkSync, mkdirSync } from "node:fs";
import path from "node:path";

const dbPath = process.env.DB_PATH || path.join(process.cwd(), "storage", "grader.db");
const backupDir = process.env.BACKUP_DIR || path.join(path.dirname(dbPath), "backups");
const retentionDays = Number(process.env.RETENTION_DAYS || 30);

mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
const dest = path.join(backupDir, `grader-${stamp}.db`);

const db = new Database(dbPath);
db.pragma("busy_timeout = 5000"); // matches src/db/index.ts — waits out a concurrent write from the live app
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
db.close();
console.log(`Backed up ${dbPath} -> ${dest}`);

const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
let pruned = 0;
for (const file of readdirSync(backupDir)) {
  if (!/^grader-.*\.db$/.test(file)) continue;
  const full = path.join(backupDir, file);
  if (statSync(full).mtimeMs < cutoff) {
    unlinkSync(full);
    pruned++;
  }
}
console.log(`Pruned ${pruned} backup(s) older than ${retentionDays} days.`);
