#!/usr/bin/env node
/**
 * Backs up the whole app, not just the database: a dated `VACUUM INTO`
 * snapshot of storage/grader.db, plus the upload tree (storage/submissions,
 * storage/review, storage/thumbnails) and config (.env, .env.local, certs/)
 * — everything that isn't reconstructible from the repo. See
 * docs/operations.md "Backup & restore" for the full design and how to run
 * a restore drill.
 *
 * Destination is BACKUP_DEST: a local/mounted path (e.g. /mnt/backup/grader)
 * or an `rsync`-over-`ssh` target (`user@host:/path`). Leaving it unset
 * keeps the old same-disk-only behavior (with a loud warning) so this is a
 * safe drop-in for the previous scripts/backup-db.mjs.
 *
 *   node scripts/backup.mjs
 *   BACKUP_DEST=/mnt/backup/grader BACKUP_KEEP=14 node scripts/backup.mjs
 *   BACKUP_DEST=cnh5@backup-host:/srv/grader-backups node scripts/backup.mjs
 *
 * Env vars — see .env.example for the full list:
 *   DB_PATH, APP_DIR, STORAGE_DIR, BACKUP_DEST, BACKUP_KEEP,
 *   BACKUP_ENCRYPT_RECIPIENT, BACKUP_ALERT_EMAIL, BACKUP_DIR/RETENTION_DAYS
 *   (same-disk fallback only, for compatibility with the previous script).
 */
import { readdirSync, statSync, unlinkSync, mkdirSync, rmSync, existsSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MEDIA_DIRS,
  CONFIG_FILES,
  CONFIG_DIRS,
  timestamp,
  isRemoteDest,
  splitRemote,
  assertSafeDirectory,
  vacuumSnapshot,
  maybeEncryptFile,
  rsyncMirror,
  shipFile,
  pruneDbSnapshots,
  writeStatus,
  mkTempDir,
} from "./lib/backup-set.mjs";

async function maybeSendFailureAlert(env, message) {
  const to = env.BACKUP_ALERT_EMAIL;
  if (!to) return;
  try {
    const nodemailer = (await import("nodemailer")).default;
    const host = env.SMTP_HOST;
    const transporter = host
      ? nodemailer.createTransport({
          host,
          port: Number(env.SMTP_PORT || 587),
          secure: Number(env.SMTP_PORT || 587) === 465,
          auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" } : undefined,
        })
      : nodemailer.createTransport({ sendmail: true, newline: "unix", path: env.SENDMAIL_PATH || "/usr/sbin/sendmail" });
    await transporter.sendMail({
      from: env.MAIL_FROM || env.SMTP_USER || "grader@localhost",
      to,
      subject: "Grader backup FAILED",
      text: `The nightly grader backup failed:\n\n${message}\n\nCheck \`journalctl --user -u grader-backup.service\` on the server.`,
    });
  } catch (err) {
    console.error("[backup] failure alert email also failed to send:", err instanceof Error ? err.message : err);
  }
}

/**
 * Runs one backup. Returns `{ ok, mode, error? }` rather than throwing, so
 * callers (the CLI entrypoint, tests) can decide what to do with a failure
 * without needing a try/catch of their own.
 */
export async function runBackup(env = process.env) {
  const appDir = env.APP_DIR || process.cwd();
  const dbPath = env.DB_PATH || path.join(appDir, "storage", "grader.db");
  const storageDir = env.STORAGE_DIR || path.join(appDir, "storage");
  const dest = env.BACKUP_DEST && env.BACKUP_DEST.trim() ? env.BACKUP_DEST.trim() : null;
  const keep = Number(env.BACKUP_KEEP || 14);
  const encryptRecipient = env.BACKUP_ENCRYPT_RECIPIENT || null;
  const startedAt = new Date();
  const log = (...a) => console.log(...a);
  const warn = (...a) => console.error(...a);

  try {
    if (!dest) {
      warn(
        "[backup] BACKUP_DEST is not set — the database snapshot is being written to the SAME DISK " +
          "as the live database. This guards against accidental deletes and bad migrations, but NOT " +
          "against disk failure, theft, or the server going up in smoke. Set BACKUP_DEST (see .env.example) " +
          "to back up somewhere else. Uploads and config are NOT backed up at all in this mode.",
      );
      const backupDir = env.BACKUP_DIR || path.join(path.dirname(dbPath), "backups");
      mkdirSync(backupDir, { recursive: true });
      const snapshot = path.join(backupDir, `grader-${timestamp(startedAt)}.db`);
      vacuumSnapshot(dbPath, snapshot);
      log(`Backed up ${dbPath} -> ${snapshot}`);

      const retentionDays = Number(env.RETENTION_DAYS || 30);
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
      log(`Pruned ${pruned} backup(s) older than ${retentionDays} days.`);
      const status = {
        ok: true,
        mode: "same-disk",
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        snapshot,
      };
      try {
        assertSafeDirectory(backupDir, { appDir });
        writeStatus(backupDir, status);
      } catch {
        /* status file is best-effort */
      }
      return status;
    }

    const remote = isRemoteDest(dest);
    if (remote) {
      assertSafeDirectory(splitRemote(dest).remotePath);
    } else {
      assertSafeDirectory(dest, { appDir });
    }

    const tmpDir = mkTempDir("grader-backup-");
    try {
      const stamp = timestamp(startedAt);
      let dbSnapshot = path.join(tmpDir, `grader-${stamp}.db`);
      vacuumSnapshot(dbPath, dbSnapshot);
      dbSnapshot = maybeEncryptFile(dbSnapshot, encryptRecipient, warn);
      const dbDest = remote ? `${dest}/db` : path.join(dest, "db");
      shipFile(dbSnapshot, dbDest);
      log(`DB snapshot -> ${dest}/db/${path.basename(dbSnapshot)}`);

      for (const name of MEDIA_DIRS) {
        const src = path.join(storageDir, name);
        const mediaDest = remote ? `${dest}/media/${name}` : path.join(dest, "media", name);
        rsyncMirror(src, mediaDest, log);
      }
      log(`Media mirrored -> ${dest}/media/{${MEDIA_DIRS.join(",")}}`);

      for (const file of CONFIG_FILES) {
        const src = path.join(appDir, file);
        if (!existsSync(src)) continue;
        let staged = path.join(tmpDir, file);
        mkdirSync(path.dirname(staged), { recursive: true });
        // copy so encryption never touches the live .env
        rmSyncIfExists(staged);
        cpFile(src, staged);
        staged = maybeEncryptFile(staged, encryptRecipient, warn);
        shipFile(staged, remote ? `${dest}/config` : path.join(dest, "config"));
      }
      for (const name of CONFIG_DIRS) {
        const src = path.join(appDir, name);
        const confDest = remote ? `${dest}/config/${name}` : path.join(dest, "config", name);
        rsyncMirror(src, confDest, log);
      }
      log(`Config mirrored -> ${dest}/config/`);

      const prunedCount = pruneDbSnapshots(dest, keep, log);

      const status = {
        ok: true,
        mode: remote ? "rsync" : "local",
        dest,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        dbSnapshot: path.basename(dbSnapshot),
        keep,
        pruned: prunedCount,
        encrypted: Boolean(encryptRecipient),
      };
      writeStatus(dest, status);
      return status;
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`[backup] FAILED: ${message}`);
    try {
      if (dest) writeStatus(dest, { ok: false, error: message, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString() });
    } catch {
      /* best effort */
    }
    await maybeSendFailureAlert(env, message);
    return { ok: false, error: message };
  }
}

function rmSyncIfExists(p) {
  if (existsSync(p)) rmSync(p, { force: true });
}

function cpFile(src, dest) {
  copyFileSync(src, dest);
}

export async function main() {
  const result = await runBackup(process.env);
  if (!result.ok) {
    console.error(`Backup failed: ${result.error}`);
    process.exitCode = 1;
    return result;
  }
  console.log(`Backup succeeded (${result.mode}).`);
  return result;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
