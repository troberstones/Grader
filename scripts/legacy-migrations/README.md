# Legacy migration scripts

These `apply-*.mjs` scripts are the **old** migration mechanism. Before
`scripts/migrate.mjs` existed, `scripts/deploy-remote.sh` ran every script
matching `scripts/apply-*.mjs`, in alphabetical order, on every deploy —
which was never dependency order (`apply-active-course-*` sorts before
`apply-auth-*`, which creates the table it alters) and left `0001`–`0004`
with no applier at all. See `docs/operations.md` for the replacement.

They are kept here, unmodified, for two reasons:

1. **History.** Each one documents a schema change (and, for a few, a data
   backfill — `apply-course-terms-migration.mjs` parses the old free-text
   `courses.semester` into `year`/`term`; `apply-course-membership-migration.mjs`
   seeds `course_members` so existing instructors aren't locked out of
   existing courses) that the corresponding `drizzle/NNNN_*.sql` file alone
   doesn't fully capture. If you need to know exactly what a past migration
   did to production data, read the script, not just the SQL.
2. **Tests.** `test/migrations.test.mjs` builds a database "the old way" —
   raw `drizzle/0000`–`0013` SQL plus
   `apply-rubric-share-model-migration.mjs` — specifically to prove the new
   runner's baselining detects that history correctly and produces the same
   schema as a fresh database. Don't delete or rewrite these scripts without
   updating that test.

**Do not run these directly against `storage/grader.db` anymore, and do not
add a new one here.** New schema changes get a `drizzle/NNNN_*.sql` file and
nothing else — `scripts/migrate.mjs` is the only runner now. If a change
needs backfill logic a plain `.sql` file can't express, put that logic in
the migration's own transaction inside `scripts/lib/migrations.mjs` (see how
`drizzle/0014_rubric_share_model.sql`'s baseline probe and the
duplicate-column tolerance in that file work) rather than writing a new
one-off applier.
