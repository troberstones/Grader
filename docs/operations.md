# Operations

## Migrations

There is exactly one migration runner: `scripts/migrate.mjs`, built on
`scripts/lib/migrations.mjs`. `scripts/init-db.mjs`, `test/global-setup.ts`,
and `scripts/deploy-remote.sh` all go through it, so "a fresh database" and
"a database migrated in production" are always the same schema.

```
node scripts/migrate.mjs              # apply pending migrations
node scripts/migrate.mjs --dry-run    # print the plan, change nothing
npm run db:migrate                    # same as the first
npm run db:migrate -- --dry-run       # same as the second
DB_PATH=path/to.db node scripts/migrate.mjs   # against a specific file
```

It always prints the plan — one line per `drizzle/NNNN_*.sql` file, saying
whether it's already applied, being baselined, or about to run — before
doing anything.

### Adding a migration

1. Change `src/db/schema.ts`.
2. Write `drizzle/00NN_description.sql` by hand. Check `git branch -a` as
   well as `drizzle/` for the next number first — see the "migration numbers
   collide across parallel branches" entry in `docs/open-threads.md`.
   Statements that must run as separate steps (SQLite can't `ALTER COLUMN`,
   so widening/narrowing a column is add/copy/drop/rename) are separated by
   a `--> statement-breakpoint` line, matching every existing migration.
3. Add an entry for it to `ARTIFACT_PROBES` in `scripts/lib/migrations.mjs`:
   a function that inspects `sqlite_master` / `PRAGMA table_info` for
   something only this migration's SQL creates (a table, a column, an
   index). This is what lets the runner baseline a database that already
   has your change from before this file existed, without erroring out by
   re-running a bare `ALTER TABLE ... ADD COLUMN`.
   - The probe must check for *positive* presence, never absence. Baselining
     evaluates every probe against a single snapshot of the database, before
     running anything, so a migration that only removes or relaxes
     something (e.g. dropping a column or an index) can't be probed that
     way — its "already gone" condition would be true before an earlier,
     still-pending migration has even created the thing. Put a migration
     like that in `ALWAYS_APPLY_ON_BASELINE` instead, and make sure its SQL
     is safe to run against a database that already doesn't have whatever
     it's removing (e.g. `DROP INDEX IF EXISTS`, `DROP COLUMN` guarded by
     checking first — see `drizzle/0014_rubric_share_model.sql`'s comment
     for the column-rebuild case, which is naturally re-runnable regardless
     of its starting state).
4. Run `npm test` — `test/migrations.test.mjs` proves a from-scratch
   database and a baselined one end up identical.

### Why not `drizzle-kit generate` / `drizzle-kit migrate`

`drizzle/meta/_journal.json` only records `0000`. Every migration since
(`0001`–`0014`) was added by hand as a loose `.sql` file, without ever
re-running `drizzle-kit generate`, because most of them needed either a data
backfill (`courses.year`/`term` parsed from the old free-text `semester`) or
a check against columns that don't exist on every database yet — neither of
which `drizzle-kit`'s generated SQL can express. Filename order, not the
journal, is what this repo treats as authoritative.

Running `drizzle-kit generate` against the current schema would diff it
against the stale `0000` snapshot and emit a new migration recreating
everything since — every column, table and backfill from `0001` through
`0014` — as if none of it had happened. Running `drizzle-kit migrate` would
do the same in reverse: since the journal says nothing after `0000` has run,
it would try to apply all of that generated SQL to a database that already
has it, and fail on the first `CREATE TABLE` or `ADD COLUMN` that already
exists. Don't run either against this repo's `drizzle/` folder as it stands;
use `scripts/migrate.mjs`.

### `scripts/legacy-migrations/`

Before this runner existed, `scripts/deploy-remote.sh` ran every
`scripts/apply-*.mjs` script, alphabetically, on every deploy. That was
never dependency order (`apply-active-course-*`, which alters `users`,
sorted before `apply-auth-*`, which creates it) and `0001`–`0004` had no
script at all, so they were likely never applied to production before this
fix. Those scripts are kept, unmodified, under `scripts/legacy-migrations/`
for the history they document (some did real data backfills a plain `.sql`
file can't) and because `test/migrations.test.mjs` uses one of them to
rebuild a pre-runner database and prove baselining handles it. See the
README in that folder. Don't run them directly anymore, and don't add a new
one — see "Adding a migration" above.

### Known intentional gap: `courses.year` / `courses.term`

`src/db/schema.ts` declares both `.notNull()`. `drizzle/0007_course_terms.sql`
adds them as nullable columns. This is deliberate, not a bug to fix: every
write path (`createCourse`, `copyCourse` in `src/actions/courses.ts`) takes
`year`/`term` as required, non-optional TypeScript fields, so the
application never writes a null into either column. Adding a `NOT NULL`
constraint at the SQL level would require a full table rebuild (SQLite can't
`ALTER COLUMN`) against the one production `courses` table, for a guarantee
the application already enforces — not worth the risk to production data for
this schema. If that changes (e.g. a raw SQL import path bypasses the
actions), revisit this.

### Migrating production safely

`scripts/deploy-remote.sh` already does this (backup, then
`scripts/migrate.mjs`, then build and restart) on every deploy. To run it by
hand, e.g. to see what the *first* run against the live database will do
before it's wrapped into a deploy:

```
ssh cnh5@cs-1017245.cs.byu.edu
cd /work/cnh5/grader
node scripts/backup-db.mjs                 # timestamped snapshot under storage/backups/
node scripts/migrate.mjs --dry-run         # read the plan — nothing runs yet
node scripts/migrate.mjs                   # apply it
```

The dry run matters most the first time this runner touches a database that
predates it: that's the baselining path, and the plan is how you catch a
migration it wrongly thinks is new (which would actually run, changing
schema) before it happens, rather than after. Once `schema_migrations`
exists, every later run is either a no-op or applies only what's genuinely
new, so the dry run stops being load-bearing — habit-forming to keep doing
anyway.

## Backup & restore

`scripts/backup.mjs` backs up everything a restore actually needs: a dated
`VACUUM INTO` snapshot of `storage/grader.db`, the upload tree
(`storage/submissions`, `storage/review`, `storage/thumbnails`), and config
(`.env`, `.env.local`, `certs/`). `scripts/backup-db.mjs` — the name every
existing caller (`npm run db:backup`, `scripts/deploy-remote.sh`,
`scripts/systemd/grader-backup.service`) already uses — is now a thin
wrapper that delegates to it, so nothing else had to change.

### Layout of a backup set

Everything lives under one destination, `BACKUP_DEST`:

```
<BACKUP_DEST>/
  db/grader-<YYYY-MM-DD-HHMMSS>.db[.age|.gpg]   dated snapshots
  media/{submissions,review,thumbnails}/         rsync mirror, current state
  config/{.env,.env.local,certs/}[.age|.gpg]     rsync mirror, current state
  attic/<YYYY-MM-DD-HHMMSS>/{media,config}/      what that night's run removed
                                                 or overwrote in the mirrors
  status.json                                    outcome of the last run
```

**Why media/config are a mirror, not dated snapshots.** The two options on
the table were (a) a dated, hardlinked tree per run (`rsync --link-dest` to
the previous night) or (b) a single mirror kept in sync with `rsync -a
--delete`, plus dated snapshots for the database only. This picks (b): rsync
already only transfers what changed, so it's just as "incremental" as (a)
in the sense that matters (nightly run time and bandwidth), but it's far
simpler to reason about, browse, and restore — there's exactly one copy of
the media tree to look at, not N mostly-identical hardlinked trees. 

A bare mirror would copy a disaster faithfully: a submission deleted or
overwritten on the server (by a bug, a re-upload, an operator mistake)
would vanish from the backup the next night. So nothing the mirror would
delete or overwrite is thrown away — it moves to `attic/<stamp>/` for that
night, keeping its path (`attic/2026-09-02-033000/media/submissions/12/34/render.png`).
To get a lost file back, find it in the attic and copy it into place. Attic
nights are pruned together with the DB snapshots: once the oldest kept
snapshot is newer than an attic night, that night goes. For local
destinations the attic step is done in Node (rename only) before rsync runs;
for `user@host:` destinations it's rsync's `--backup --backup-dir`, which
needs GNU rsync on the receiving end — macOS's bundled openrsync silently
skips deletions when `--backup-dir` is set.

**Why `storage/rubrics` and `storage/exports` aren't backed up.** Neither is
written to by anything under `src/` today (`RUBRICS_DIR`/`EXPORTS_DIR` in
`src/lib/constants.ts` are unused elsewhere) — nothing there to lose. Add
them to `MEDIA_DIRS` in `scripts/lib/backup-set.mjs` if that changes.

### Configuring `BACKUP_DEST`

Nothing is backed up off-box until this is set — that decision (a mounted
second disk, a NAS, another host) belongs to whoever administers the
server, not to this repo, so it ships unset. Until then, `backup.mjs` falls
back to exactly the old `backup-db.mjs` behavior — a same-disk DB snapshot —
and logs a loud warning on every run that it's on the same disk as the live
database and that uploads/config aren't covered at all.

Once a destination exists, set it in `.env.local` (picked up by
`grader-backup.service` via `EnvironmentFile=`) or directly in
`scripts/systemd/grader-backup.service`:

```
BACKUP_DEST=/mnt/backup/grader                              # local/mounted path
BACKUP_DEST=cnh5@backup-host.example.edu:/srv/grader-backups # rsync over ssh
```

A remote target needs passwordless SSH (a key in `~/.ssh/authorized_keys` on
the backup host for `cnh5`) and `rsync`/`ssh` on both ends — nothing else.
For a remote target, the DB snapshot is always made locally first (VACUUM
INTO a temp file) and then shipped over; SQLite is never pointed at a
network filesystem.

Other knobs (see `.env.example` for the full list with defaults):

- `BACKUP_KEEP` (default 14) — how many dated DB snapshots to retain.
  Applies once `BACKUP_DEST` is set; the same-disk fallback keeps its old
  `RETENTION_DAYS`-based (default 30 days) pruning instead, for backward
  compatibility with the previous script.
- `BACKUP_ENCRYPT_RECIPIENT` — an `age` recipient (`age1...`) or a `gpg` key
  id. When set, the DB snapshot and the two config files are encrypted
  before they leave this host (`.age`/`.gpg` extension tells `restore.mjs`
  which). Needs `age` or `gpg` installed; skipped with a loud warning
  otherwise. The media mirror is **not** encrypted — encrypting a
  multi-gigabyte tree on every run would defeat the point of an incremental
  rsync, and it wasn't obviously simple to do without that cost, so this is
  a documented follow-up rather than a half-solution. If the media itself
  needs encryption at rest, encrypt the destination volume (e.g. LUKS)
  instead of the backup tool.
- `BACKUP_ALERT_EMAIL` — gets a plain-text email on failure, reusing
  whatever mail transport `src/lib/email.ts` already has configured
  (`SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` or local sendmail). Best-effort: a
  failed alert email is logged but never turns a failed backup into a
  crashed script, and never blocks anything.

### Running it

```
node scripts/backup.mjs                    # uses BACKUP_DEST etc. from the environment
npm run db:backup                          # same thing, via the old script name
DB_PATH=... BACKUP_DEST=... node scripts/backup.mjs   # against a specific database
```

Exits non-zero with a message on any failure (a bad destination, `rsync`
failing, a locked database that never releases within the busy timeout,
...). `scripts/systemd/grader-backup.timer` runs it nightly at 03:30 with a
±10 minute random delay. That's a `--user` timer, so **it only fires while
`cnh5` is logged in** unless lingering is enabled once:

```
loginctl enable-linger cnh5
```

### Checking status

Every run — success or failure — writes `status.json` to the destination
(or `storage/backups/status.json` in same-disk mode):

```json
{
  "ok": true,
  "mode": "rsync",
  "dest": "cnh5@backup-host.example.edu:/srv/grader-backups",
  "startedAt": "2026-09-25T03:30:04.120Z",
  "finishedAt": "2026-09-25T03:31:47.881Z",
  "dbSnapshot": "grader-2026-09-25-033004.db",
  "keep": 14,
  "pruned": 1,
  "encrypted": false
}
```

There's no dashboard reading this yet — it's there for a future health
check (or `cat`) to answer "when did backups last actually succeed" without
grepping the journal. In the meantime: `journalctl --user -u
grader-backup.service` shows every run's output, and `systemctl --user
list-timers grader-backup.timer` shows when it last fired and next will.

### Restore drill

`scripts/restore.mjs` is the tested-restore procedure the operations audit
asked for — run it periodically (e.g. monthly), not only when something is
actually on fire:

```
node scripts/restore.mjs --dest /mnt/backup/grader --verify
```

This restores the latest snapshot set into a fresh temp directory (printed
in the output; never the live app dir), then:

1. Opens the restored database and runs `PRAGMA integrity_check`.
2. Counts rows in the key tables (`users`, `courses`, `students`,
   `assignments`, `submissions`, `grades`, `rubrics`).
3. For every submission, confirms `file_path` (and `thumbnail_path`, if set)
   actually exists under the restored tree.
4. Prints a report ending in `RESULT: PASS` or `RESULT: FAIL`, and exits
   non-zero on `FAIL`.

Useful variations:

```
# Restore a specific night instead of the latest:
node scripts/restore.mjs --dest /mnt/backup/grader --snapshot grader-2026-09-20-033000.db --verify

# Restore somewhere you can poke around by hand instead of a throwaway temp dir:
node scripts/restore.mjs --dest /mnt/backup/grader --into /tmp/grader-inspect
```

**Actually recovering the live server** (not a drill — the running app must
already be stopped, because this overwrites `storage/` and config in place):

```
systemctl --user stop grader.service
node scripts/restore.mjs --dest /mnt/backup/grader --into-live --yes --confirm-service-stopped --verify
systemctl --user start grader.service
```

`--into-live` refuses to run at all unless both `--yes` and
`--confirm-service-stopped` are given — a bare `--into-live` is deliberately
not enough. Where `systemctl` is available, it additionally checks
`systemctl --user is-active grader.service` and refuses if the service
turns out to still be running, flags or no flags.

Before writing the restored database, `--into-live` renames the current
`storage/grader.db` and any `grader.db-wal`/`grader.db-shm` beside it to
`*.pre-restore-<stamp>`. A leftover WAL from the old database would
otherwise be replayed onto the restored one the next time the app opens it,
and keeping the old file means restoring the wrong snapshot can be undone.
Delete the `.pre-restore-*` files by hand once the restore is confirmed good.

### What this doesn't cover

- **Media/config history only covers what changed.** The attic keeps each
  night's deleted or overwritten files, not a full point-in-time tree, so a
  restore brings back *current* media alongside an older DB snapshot. Files
  the old snapshot references but that were since deleted are in the attic
  and reported as missing by `--verify`.
- **No automated restore-drill schedule.** `restore.mjs --verify` is a
  command to run by hand (or from a separate cron/timer an operator sets
  up), not something this change wires up on its own.
- **No media/config encryption.** Documented as a follow-up above.
- **No health-check integration.** `status.json` exists for one to read
  later; nothing reads it yet.
- **First run against a brand-new `BACKUP_DEST`** does a full copy of
  whatever's already in `storage/` — expect that one to take much longer
  than every night after it.

## Deploy

`./scripts/deploy-remote.sh` builds a new release in a staging copy on the
server and only swaps it into the live app if the build and a post-restart
health check both succeed. The live app keeps serving classes the entire
time the build runs; a bad build never reaches it at all.

```
./scripts/deploy-remote.sh
```

Three directories on the server, all under `/work/cnh5`:

- `grader` — the live app (`REMOTE_DIR`). `storage/`, `certs/`, and `.env*`
  live only here and are never duplicated, overwritten, or deleted by any
  step of the deploy.
- `grader-staging` (`STAGING_DIR`) — the working tree is rsynced here, then
  `npm ci` and `next build` run here, while `grader` keeps running unchanged.
- `grader-previous` (`PREVIOUS_DIR`) — a full copy (code, `node_modules`,
  `.next`) of whatever was live immediately before the last swap, kept for
  rollback. Overwritten on every successful deploy, so it only ever holds one
  generation back.

What one run does, in order:

1. Rsync the working tree to `grader-staging` (same excludes as before:
   `.gitignore`, `.git`, `.claude`, `packages/*/node_modules`).
2. `npm ci` and `npm run build` in `grader-staging`. **If either fails, the
   script exits here and the live app is untouched** — nothing below this
   point has happened yet.
3. Snapshot the current live release into `grader-previous` (skipped on a
   fresh install with nothing live yet).
4. Stop `grader.service`.
5. Back up the database (`node scripts/backup-db.mjs`, same as before).
6. Migrate the *live* database using the *staging* copy's `scripts/migrate.mjs`
   (so a new release's new migrations run), via
   `DB_PATH=.../grader/storage/grader.db`.
7. Swap `grader-staging`'s code, `node_modules`, and `.next` into `grader`
   (rsync with `--delete`, excluding the top-level `/storage`, `/certs`,
   `/.env*` only — anchored so a `node_modules` package that happens to be
   named `storage` still gets updated).
8. Install `scripts/systemd/grader.service` **only if no unit is installed
   yet**. The unit running on the server today was set up by hand and may
   carry settings the committed file doesn't, so when the two differ the
   script prints the diff and keeps the installed one — merge by hand if
   the committed version should win. Then `daemon-reload` and restart.
9. Poll `GET /api/health` (see "Health & monitoring" below) for up to ~30s.
   - Healthy: done. `grader-backup.service`/`.timer` are reinstalled and
     (re-)enabled, same as the previous version of this script did.
   - Not healthy: **automatically rolls back** — rsyncs `grader-previous` back
     over `grader` and restarts. If that comes up healthy, the new release
     never went live; if it doesn't either, the script says so and stops —
     that's a "someone needs to look at this machine" situation, not one to
     retry automatically.

If any step from 4 on fails outright (the backup, the migration, the
rsync), the script doesn't just exit with the app stopped: before the swap
it starts the untouched previous release again; mid-swap it restores
`grader-previous` first.

After an automatic rollback, "healthy" also accepts any non-5xx answer from
`/login`, because the release being rolled back to may predate
`/api/health`.

**The one thing a failed health check does *not* undo is the database
migration** (step 6) — see "Rollback" below.

`NODE_BIN` at the top of the script is the one source of truth for which
Node install runs the app; `scripts/systemd/grader.service`'s `ExecStart`
must be kept pointed at the same path by hand, since a systemd unit can't
read a shell variable.

### First deploy to a new host

`scripts/deploy-remote.sh` assumes `grader.service` may not exist yet (it
installs/enables it) but does assume `/work/cnh5` exists and `rsync`/`ssh`
access is set up. It does not run `scripts/make-cert.sh` or create `.env.local`
— do both by hand first (see "Certificates" below and `.env.example`), and run
`loginctl enable-linger cnh5` once so `grader.service` and `grader-backup.timer`
keep running without an active SSH session — see "Health & monitoring" and
`scripts/systemd/grader.service`'s own comment for why.

## Rollback

Two ways a release stops being live again:

- **Automatic**, inside `deploy-remote.sh` itself, when the post-restart
  health check fails — see step 9 above. Nothing to run by hand.
- **Manual**, any time later, for a release that passed its health check but
  is still wrong in some way the health check can't see (a UI regression, a
  feature that misbehaves only for a real class):

  ```
  ./scripts/rollback-remote.sh
  ```

  Restores `grader-previous` over `grader` (same excludes as the deploy
  script: `storage/`, `certs/`, `.env*` untouched) and restarts, then waits
  for `/api/health`. Since `grader-previous` is overwritten on every deploy,
  this only ever goes back one release — there is no deeper history to roll
  back through.

**Neither rollback path undoes a database migration.** Every migration this
app ships only adds tables/columns (see "Adding a migration" above), so old
code ignores what a rolled-back-from release added and rollback is normally
safe on its own. If a migration itself is the problem — bad data, a slow
migration that locked the table, whatever — the fix is restoring the
`storage/backups/` snapshot `scripts/backup-db.mjs` took immediately before
that deploy's migration ran (see "Backup & restore"), not the rollback
scripts here.

## Health & monitoring

`GET /api/health` — no authentication, returns nothing beyond ok/not-ok (no
paths, versions, or counts, since nothing guards it):

```
200 {"ok": true}    — database reachable, storage disk has >= 2 GB free
503 {"ok": false}   — either check failed
```

Checks a `SELECT 1` against the database and `fs.statfs` on the directory
`storage/grader.db` (or `$DB_PATH`) lives in. Details of *why* it failed go
to the server log (`journalctl --user -u grader`), not the response.

Used by `deploy-remote.sh` and `rollback-remote.sh` after every restart
(`curl -fsk https://localhost:$PORT/api/health`, falling back to `http://` if
no certificate is installed); safe to also point an external uptime monitor
at it, or to check by hand:

```
curl -sk https://cs-1017245.cs.byu.edu:3000/api/health
```

### Startup warnings

Every time the server starts (`src/instrumentation.ts` → `src/lib/preflight.ts`,
via Next's `register()` hook — runs under `server.mjs`'s custom server the
same as it would under `next start`), it logs a warning to stdout/stderr for
each of the following that's true, without refusing to start:

- `APP_BASE_URL` unset — invite/reset/upload-link/feedback-link emails are
  skipped.
- No `SMTP_HOST` and no working local `sendmail` — no mail can be sent at
  all.
- `ffmpeg` (or `ffprobe`) not found on `PATH`/`FFMPEG_PATH` — feedback emails
  lose annotated video frames, video ingest may fail.
- `ALLOWED_EXTENSION_ORIGINS` unset — the LS Bridge extension can't upload.
- No TLS certificate at `certs/server.key`/`certs/server.crt` (or the paths
  `TLS_KEY`/`TLS_CERT` point at), or one that's expired or expires within 30
  days.

Check for these after every deploy and after any host change:

```
journalctl --user -u grader --since "5 minutes ago" | grep preflight
```

### Large uploads

`server.mjs` sets `requestTimeout = 60 minutes` and `headersTimeout = 60s`
on both the HTTP and HTTPS servers it runs. Node's default `requestTimeout`
(5 minutes) was killing large submission/EXR-sequence uploads over the
studio's slow upstream partway through. An hour covers any real upload
while still bounding a client that trickles a body forever; `headersTimeout`
stays short so a connection that never finishes sending headers can't hold
a slot.

## Certificates

`scripts/make-cert.sh` generates the self-signed certificate `server.mjs`
serves HTTPS with (see that script's own comment for the Apple-platform
requirements it satisfies, and its file header for why HTTPS exists at all).
`certs/` is gitignored and excluded from every rsync in `deploy-remote.sh` and
`rollback-remote.sh`, so a certificate survives every deploy untouched.

- Generate/replace: `./scripts/make-cert.sh [hostname] [--force]`, then
  `systemctl --user restart grader.service`.
- A missing or unreadable certificate is not fatal: `server.mjs` logs why and
  falls back to HTTP-only rather than refusing to start (see its file
  comment — this is deliberate, since HTTP must keep working for any device
  that hasn't installed/trusted the certificate).
- The preflight check above warns 30 days before expiry (and after) on every
  server start, and `/api/health` still passes even with an expired
  certificate, since the app itself is otherwise fine — it's read by whoever
  reads the startup log, not enforced by health checks.
