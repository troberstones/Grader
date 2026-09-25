#!/usr/bin/env node
/**
 * Compatibility entry point — `npm run db:backup`, `scripts/deploy-remote.sh`,
 * and scripts/systemd/grader-backup.service all still invoke this file by
 * name. The real implementation (DB snapshot, plus uploads and config when
 * BACKUP_DEST is configured) now lives in scripts/backup.mjs; this just
 * delegates to it so none of those callers needed to change.
 *
 *   node scripts/backup-db.mjs
 *   BACKUP_DEST=/mnt/backup/grader node scripts/backup-db.mjs
 *
 * See docs/operations.md "Backup & restore" and .env.example for the
 * available options.
 */
import { main } from "./backup.mjs";

await main();
