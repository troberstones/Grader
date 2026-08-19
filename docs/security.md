# Security notes

Written 2026-08-12, when the rubric gained a dock beside the art reviewer.

> **Updated 2026-08-14.** Grader now has authentication *and* authorization:
> every server action and same-origin route handler requires a signed-in
> session with the right capability. What is still open on purpose is the
> Learning Suite bridge (`/api/ls-bridge/*`, `/api/submissions/upload`) — a
> browser extension calls these cross-origin, which is structurally
> incompatible with cookie sessions. Read "Known gaps" below.

This is a note, not a claim. Grader has real authorization as of 2026-08-14 for
everything reachable from its own signed-in browser tab. The Learning Suite
bridge is the one deliberate exception, not an oversight — see gap #1.

## The invariant worth protecting

**Grades must never travel on the sync bus.**

The review session is multi-host by design: the iPad drives, and other machines
— including whatever is plugged into the projector — follow. Every follower
renders what the master broadcasts. So the rule is simple: if a piece of state
is broadcast, assume a room full of students can see it.

Today grades satisfy this by construction:

- `GlobalSyncPayload` (`src/components/shared/global-sync.tsx`) carries exactly
  four event types — `navigate`, `playback`, `annotation-saved`,
  `playback-master`. None contains a score, a level, or feedback text.
- Grade writes go through server actions (`src/actions/grades.ts`), not the bus.
- The rubric dock is a **sibling** of the art reviewer, not part of it
  (`review-client.tsx`). Scores live in grader's own React tree and never become
  viewer state, which is what gets serialised into sync actions.
- Switching between Rubric and Artwork is local navigation. It does not
  broadcast, so opening the rubric on the iPad leaves the projector on the
  artwork. This was previously true by accident — `navigate` only fires on an
  assignment change — and is now true on purpose.

If you ever add a sync action carrying grade data, or move the rubric inside
`ArtReviewer`, you have broken this. There is no runtime guard; it is a
structural property, which is why the structure is worth keeping.

**Content — real annotation ink, not scores — is a related but separate
invariant, and it used to be broken.** `useReviewChannel`
(`src/lib/review-channel.ts`) rides the same global `/api/sync` bus to carry
live stroke data, tagged with a `ctx` string and filtered only client-side —
so until this was fixed, every connected instructor/assistant received every
course's live annotation ink, not just their own. `/api/sync/route.ts` now
resolves each broadcast's course (via its `assignmentId`, direct on the four
`GlobalSyncPayload` types or parsed from `ctx` on art-review actions) and
fans it out only to listeners with real `roster.view` access to that course —
same capability the rest of this doc uses for real per-student content. The
four safe event types are filtered by the same mechanism, closing a second,
unrelated bug where navigate/playback events crossed between two unrelated
instructors' sessions.

## Known gaps

Roughly in the order they'd matter if the tool left the studio:

1. **~~No authentication.~~ ~~The API is not.~~ One corner of it still is, on
   purpose.** `src/proxy.ts` redirects unauthenticated page requests, the root
   layout re-checks the session against the database, and every server action
   (`src/actions/*.ts`) and same-origin route handler now calls
   `requireCapability()` / `apiRequireCapability()`
   (`src/lib/auth/require.ts`, `src/lib/auth/api.ts`) before touching the
   database. That covers `/api/submissions/[id]/file`, `/api/review/*`, and
   `/api/sync/*` — all fetched from grader's own signed-in tab, so the session
   cookie travels normally.

   **`/api/ls-bridge/*` and `/api/submissions/upload` stay open.** A Chrome
   extension content script running inside Learning Suite's own origin calls
   these directly. That is cross-origin by definition: the routes answer with
   `Access-Control-Allow-Origin: *` so the extension can reach them at all, and
   a wildcard origin forbids credentialed requests by spec — the session
   cookie could not travel here even if grader tried to send it, and
   `sameSite=lax` would block it on the way in regardless. Gating these with a
   cookie check wouldn't add security, it would just break the LS sync. A real
   fix needs a *machine* credential — a shared API key the extension sends in
   a header — which is a separate feature, not implemented yet. Until then,
   anything that can reach the port can sync rosters, assignments, and files
   through these four routes. This is the largest remaining gap.
2. **`allowedDevOrigins` uses subnet wildcards** (`192.168.86.*` and friends, in
   `next.config.ts`). Necessary because DHCP moves the studio machine between
   sessions, but it means any host on those subnets is a permitted origin.
3. **~~Authorization exists globally, not per course.~~ Closed by
   `course_members`.** `can()` in `src/lib/auth/roles.ts` decides on a
   *resource*, and both global roles (admin/instructor/assistant) and
   per-course membership are enforced — `COURSE_SCOPING_PENDING` (still
   greppable, kept as a marker) is `false`. Real per-student content
   (`roster.view`) is membership-only regardless of department visibility;
   course *structure* (`course.view`) deliberately stays browsable across a
   department so a course can be found and copied without joining it first —
   see "Course copy" in `docs/accounts-and-courses.md`.

   `author.id` is still hard-coded to `"instructor"` in the review route, so
   strokes do not yet carry a real author even though the schema has the column.
4. **The follower has no way to verify the master.** `/api/sync/*` now
   requires a signed-in session — confirmed with the studio: the machine
   plugged into the projector signs in like anything else — but any signed-in
   account can post `playback-master` first and become master. That narrows
   the earlier "anything on the subnet" hijack to "anyone with an account,"
   which is the right size for a multi-instructor tool but is still not a
   real claim check. Worth a real `sender` credential if this ever hosts more
   than one crit at a time.
5. **~~Student media is served without a check.~~ ~~And gated on the wrong
   capability.~~** `/api/review/media/[mediaId]`, `/api/review/layers/[id]`,
   and `/api/submissions/[id]/file` first required a signed-in session, then
   (this sweep) `roster.view` — real course membership, not the department-
   visibility bypass `course.view` grants. That bypass is deliberate for
   course *structure* (see the "Course copy" note in
   `docs/accounts-and-courses.md`), but several call sites were reusing it to
   gate actual student content: submission files, review media/annotations,
   and the grade sheet (`getGradeSheet` in `src/actions/grades.ts`) all
   returned real data to any instructor/assistant on a department-visible
   course, member or not. All now require `roster.view`
   (`src/lib/auth/roles.ts`), which — unlike `course.view` — never honors
   department visibility. See "What is already fenced off" below.

6. **Sessions travel over plain HTTP.** Cookies are `httpOnly` and
   `sameSite=lax` but not `secure`, because the studio LAN has no TLS and a
   secure cookie would simply never be sent. Set `SECURE_COOKIES=1` when this
   moves behind HTTPS — the flag is configuration, not a code change.

7. **~~No rate limiting on sign-in.~~ Two layers now cover it.** See "What is
   already fenced off" below.

## What is already fenced off

- **Every server action and same-origin route handler checks a capability.**
  `requireCapability()` (actions) and `apiRequireCapability()` (route
  handlers) both call `can(user, capability, resource)` — every exported
  function in a `"use server"` file is independently reachable by RPC id
  whether or not a page currently calls it, so the check lives inside each
  function rather than at whichever page happens to call it today. Reads of
  course *structure* (assignments, rubrics, course metadata — deliberately
  browsable across the department, see "Course copy" in
  `docs/accounts-and-courses.md`) need `course.view`; reads of real
  per-student *content* (roster, submissions, grades, review media/
  annotations) need `roster.view`, which is membership-only regardless of
  department visibility; writes need `course.edit`, `grade.write`, or
  `course.create` depending on what they touch.

- `/api/review/diagnostics` returns 404 unless `NODE_ENV === "development"`,
  caps the body at 512 KB, and rebuilds the filename from a sanitised stem, so
  it cannot be used to write outside `storage/diagnostics/`.

- **Credentials.** Passwords are scrypt (N=16384, r=8, p=1) with a per-password
  salt, compared with `timingSafeEqual`. Session and invitation tokens are 32
  bytes of `randomBytes`; only their SHA-256 is stored, so read access to the
  database does not confer the ability to forge either. Verified: the invite
  token issued in testing appears nowhere in `invites` except as its hash.

- **Sessions are rows, not JWTs**, so disabling an account takes effect on the
  next request rather than whenever a token happens to expire. `getCurrentUser`
  drops every session belonging to a non-active account on sight.

- **Invitations are single-use.** Acceptance consumes the token in the same
  statement that checks it is unconsumed, so two submissions of one link cannot
  both create a session.

- **The last administrator cannot be demoted or disabled**, and nobody can
  disable their own account — otherwise account management becomes permanently
  unreachable without hand-editing the database.

- **Login is rate-limited two ways.** Per-account lockout
  (`users.failedLoginAttempts` / `lockedUntil`) locks an account for 15
  minutes after 5 failed attempts — durable, DB-backed, survives a restart.
  A same-shaped IP throttle (20 failures per IP per 5 minutes) sits in front
  of it, but is an in-memory `Map`, not a database table: grader runs as one
  Node process under `systemd --user`, so that tradeoff is deliberate — a
  restart clears the IP throttle, but the account-level lockout is the
  durable backstop, and a restart isn't something an attacker controls the
  timing of. See `src/lib/auth/lockout.ts`.

- **Security-sensitive actions are logged.** Grade saves/clears/missing-marks,
  role and status changes, forced sign-outs, invitations, and course/rubric
  deletes all write to `audit_log` via `writeAudit()` (`src/lib/audit.ts`) —
  best-effort, so a logging failure never blocks the action it's recording.
  Visible to admins at `/admin/audit`.

- **Invite and password-reset links are also emailed, best-effort.**
  `src/lib/email.ts` sends through the deploy host's own local mail transport
  (sendmail/postfix — no SMTP credentials, no third-party account),
  configured via `APP_BASE_URL` / `MAIL_FROM` / `SENDMAIL_PATH`. This is
  additive: the copy-link flow in `/admin/users` is unchanged and stays the
  real mechanism regardless of whether the email arrives.

## Backups

`scripts/backup-db.mjs` runs daily via `grader-backup.timer` (installed by
`scripts/deploy-remote.sh`), taking a `VACUUM INTO` snapshot into
`storage/backups/` — same technique as the manual pre-migration snapshots
already in `storage/` — and pruning anything older than 30 days.

This protects against corruption, a bad migration, or an accidental delete.
It does **not** protect against the host itself failing: `storage/backups/`
is still local disk on the same machine as `storage/grader.db`, same caveat
as the existing manual snapshots ("exists on one disk"). A real off-host
backup is still worth doing before this holds anything nobody can afford to
lose.

## Before this is exposed to anything but the studio LAN

At minimum: give the LS bridge a machine credential instead of leaving it
open, drop the origin wildcards to specific hosts, set `SECURE_COOKIES=1`
behind TLS, and decide what a student is allowed to see before `author.id`
stops being a constant.
