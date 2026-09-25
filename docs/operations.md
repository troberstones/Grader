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
