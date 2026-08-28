# Open threads

Work that has shipped but is not finished being *trusted*, plus the traps that
have already caught someone once. This is a working list, not a record: close
an item by deleting it, and add one when you leave something half-verified.

It deliberately does not re-explain designs. Where a decision is already
written up, this file points at it — two copies of a rationale means one of
them is quietly wrong within a month.

---

## 1. Review mode has never been used

**Priority: this is the one that matters.** Shipped and deployed 2026-08-28;
at the time of writing every session row on the server is `mode = 'grade'`, so
nobody — human or agent — has walked through the review path once.

What *is* verified: the capability rules are unit-tested
(`src/lib/auth/roles.test.ts`, "review mode — a session constraint, not a
role"), the live `/login` serves both buttons, and the schema is migrated. What
is **not** verified is that the resulting session is usable and shows nothing it
shouldn't. Those are different claims, and only the second one matters when the
projector is on.

Sign in with **Sign in to review** and confirm:

- the rubric is unreachable — no dock, no `t` shortcut, no Rubric segment
- annotation still draws and still saves
- picking students still works, and the sidebar shows **names only**: no status
  dots, no "n graded" bar, no netIDs, no scores
- `/assignments/<id>` redirects to that assignment's review page rather than
  refusing (`src/app/assignments/[assignmentId]/page.tsx`)
- `/analytics`, `/archive`, `/rubrics`, `/admin/*` all refuse
- signing out and back in as **grade** restores everything

The docked rubric is the subtle one. `rubricDocked` lives in `localStorage`, so
the case worth actually testing is: dock it while grading, sign out, sign back
in to review. It is denied at `canDock` for exactly this reason, but that is a
claim about code until someone does it.

Design and rationale: `docs/security.md` § *Review sessions*.

## 2. The deploy applies every migration in filename order

`scripts/deploy-remote.sh` now runs `scripts/apply-*.mjs` — all of them, every
deploy — between `npm install` and the build. That is safe because each applier
checks for what it would create and does nothing if it is already there, and it
is what stops a schema change from being half-deployed.

The soft spot: **filename order is dependency order only by luck so far.** An
applier that must run after another has to sort after it, and nothing enforces
that. If you add one whose name would sort it ahead of a prerequisite, rename
it. Alphabetically `apply-active-course-*` already sorts before
`apply-auth-*`, which would break on a database that had neither — it does not
bite today only because every deployed database is well past both.

## 3. Migration numbers collide across parallel branches

`0011` was claimed twice in one afternoon by two branches that could not see
each other, and was only caught at merge. Before numbering a new one, check
`git branch -a` as well as `drizzle/` — the number you want may exist on a
branch that has not merged yet.

## 4. `review-v1` and `review-v2` are ungated on purpose

Neither calls `requireGradeSession()`, which looks like an oversight and is not.
They are artwork viewers: no scores, no rubric, no grading affordances (checked,
not assumed). A review session reaching them is correct.

`review-v2` is additionally an orphan — nothing links to it. Deleting it is
probably right, but confirm nobody is mid-rework on it first.

## 5. Vestigial `grader.db` in the repo root

Zero bytes, dated April, tracked, and not the database. The real one is
`storage/grader.db` (`DB_PATH`, see `.env.example`). It exists on the server too.
Every so often someone opens it, finds it empty, and concludes something is
broken. Nothing reads it — every script and `src/db/index.ts` resolve
`storage/grader.db` — so `git rm grader.db` should be all it takes.

---

## Time-sensitive, verify before believing

At the time of writing the main checkout had **uncommitted work from another
session** — student hotkeys and a sync-pause fix in
`src/components/shared/grading-shell.tsx`, plus an untracked
`src/app/api/submissions/direct-upload/`. That file is contended: it also
carries review mode's nav and badge changes. If it is still dirty when you
arrive, read it from disk before editing, and do not reconstruct it from
memory of either change.

`scripts/mint-reset-link.mjs` exists for one situation: the only administrator
is locked out and so cannot use `/admin/users` to issue their own reset link.
It mints the token directly against the database and prints the URL. It handles
no passwords — the account owner sets theirs in the browser.
