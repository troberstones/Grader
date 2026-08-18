# Grader

Rubric-based grading for digital art and 3D render assignments — a Next.js
16 App Router app backed by SQLite (via Drizzle/better-sqlite3), with a
built-in art review/annotation tool (`packages/art-review`) for critiquing
submissions.

## Setup (fresh clone → running app)

Requires Node 20+ (Node 22 is what's actually deployed).

```bash
git clone https://github.com/troberstones/Grader.git
cd Grader
npm install
npm run db:init
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — a fresh database has
no accounts yet, so the app opens straight to a "create the first
administrator" screen (`/setup`). Everything else (inviting people, creating
courses, rubrics, assignments) is reachable from there.

- `npm install` also installs `packages/art-review`, an npm workspace.
- `npm run db:init` builds `storage/grader.db` from scratch by replaying
  every file in `drizzle/` — safe to re-run; it's a no-op if the database
  already has a schema. See `scripts/init-db.mjs`.
- `storage/` (the database, uploaded submissions, review media, backups) is
  gitignored — a clone starts with none of it.

### Optional: sample data

```bash
node scripts/seed-roster.mjs
node scripts/seed-rubrics.mjs
node scripts/seed-submissions.mjs
```

These seed a sample course roster, a few example rubrics, and sample
submissions, respectively — useful for exercising the app without manually
creating everything by hand. Run them after `npm run db:init` and after
creating the first administrator through `/setup`.

### Environment variables

All optional — see `.env.example` for the full list with explanations
(database path, secure-cookie flag, and the settings for best-effort email
delivery of invite/reset links). None are required for local development;
copy it to `.env.local` and fill in only what you need.

### Running on a different host

The dev server binds to all interfaces by default (`next dev`), so
`npm run dev` on any machine is reachable at that machine's own
`http://localhost:3000`. If you need to reach it from a *different* host
than the one running it, Next's dev server will reject unrecognized
cross-origin requests — see `allowedDevOrigins` in `next.config.ts`.

## Tests

```bash
npm test          # everything: rubric engine, art-review, auth/session/audit-log
npm run test:rubric  # pure rubric-scoring logic only (node --test)
npm run test:auth    # auth/session/lockout/audit-log (vitest, needs no setup — builds its own scratch DB)
```

`test:auth` builds an isolated scratch SQLite DB under `test/.db/` the same
way `db:init` builds the real one — it doesn't touch `storage/grader.db`.

## Where to look for a review

- [`docs/security.md`](docs/security.md) — the authorization model, what's
  already covered, and the known gaps (with reasoning for each).
- [`docs/accounts-and-courses.md`](docs/accounts-and-courses.md) — identity,
  course scoping, and the data-model decisions behind them.
- [`docs/rubric-authoring.md`](docs/rubric-authoring.md) — the
  dimensionless rubric-scoring model (`src/lib/rubric/`).
- [`DESIGN.md`](DESIGN.md) — the visual design system.

## Deploying

`scripts/deploy-remote.sh` rsyncs the working tree to the configured host
over SSH, builds, and restarts it as a `systemd --user` service (also
installing/enabling the `grader-backup.timer` for daily database backups).
It's written for one specific host — read it before pointing it at another.
