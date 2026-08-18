# Student accounts and self-view

Written 2026-08-17, alongside the course membership and copy work in
`docs/accounts-and-courses.md`. That work added the architecture this
depends on but deliberately stopped short of building it — this is the
follow-up plan for when a student logging in and seeing their own archive
is actually wanted.

## What already exists

- `students.userId` (nullable FK -> `users`) — the link between a roster
  record and a login account. Unpopulated today; nothing creates it.
- `"student"` is a valid `GlobalRole` (`src/lib/auth/roles.ts`), but nothing
  can create a student-role account yet — it's not offered in the admin
  invite UI (`src/app/admin/users/user-admin.tsx`), and `inviteUser`
  (`src/actions/auth.ts`) has no student-specific path.
- `can()`'s `archive.view` rule already honors self-view:
  `user.canViewArchive === true || ctx.isOwnStudentRecord === true`. Once a
  `students.userId` row is populated, that student's own account
  automatically gets `archive.view` on `{kind:"student", studentId}` for
  free — no authorization change needed, only the account-creation and UI
  pieces below.
- `getStudentArchive()` (`src/actions/archive.ts`) already returns exactly
  the shape a "my archive" page would render — grouped by course, with
  submissions, grades, and annotation counts.

## The one real blocker: grades have no publish flag

`docs/accounts-and-courses.md` called this out as a "must be right now"
item and it never actually landed: `grades` has `gradedAt` but no
`publishedAt`. *Graded* and *visible to the student* are different facts,
and right now the schema cannot tell them apart.

Ship student login without this and a student sees every score the moment
an instructor finishes grading — including work still being reconsidered,
curved, or cross-checked against a rubric argument with a TA. That is very
likely not what any instructor using this tool expects.

**This has to land before any student-facing archive page does**, even
though it's a small change: add `grades.publishedAt` (nullable text,
default null), a `publishGrade`/`publishGrades` action gated on
`grade.publish`, and change `getStudentArchive()` to filter out unpublished
grades when the caller is the student themselves (an instructor with
`canViewArchive` still sees everything — publication only gates the
student's own view).

## Open question: how does a student get an account?

Two real options, not resolved here on purpose — this needs a decision, not
an assumption:

1. **Invite by email**, same mechanism as instructors (`inviteUser` /
   `acceptInvite`, `src/actions/auth.ts`). Reuses everything: the
   single-use-token flow, the accept-and-set-password page
   (`src/app/invite/[token]/`). Fastest to build. Needs an admin (or an
   instructor, if that's ever delegated) to manually invite each student,
   which doesn't scale past a small studio class.
2. **CAS/SSO via `users.netId`**, which `docs/accounts-and-courses.md`
   already gestures at as the long-term plan for replacing local passwords
   generally ("`users.netId` exists for the same reason: it is how CAS/SSO
   will eventually replace local passwords without a migration"). A student
   authenticates via the university's SSO and an account is created or
   matched on first login, using the netId already present on `students`
   rows synced from Learning Suite. No manual invitation step, but this is
   real integration work (a CAS/OAuth client, a callback route, matching an
   incoming netId against an existing `students` row to populate
   `students.userId` on first login rather than creating an orphan account).

Given the roster is already synced from Learning Suite with `netId`
populated, option 2 is the better end state — but option 1 is a much
smaller first slice if the actual near-term want is just "let one curious
student see their own portfolio," not a general rollout. Worth deciding
based on how many students this needs to cover on day one.

## What building this actually means

Once the account-creation question above is answered:

1. **`grades.publishedAt`** (see above) — do this regardless of which
   invite path is chosen.
2. **Account creation** — either extend `inviteUser` to accept
   `globalRole: "student"` and add it to the admin invite UI (option 1), or
   build the CAS callback route and the netId-matching logic that populates
   `students.userId` (option 2).
3. **A student-scoped login surface.** Reuses `src/app/login/` almost as-is
   if going the password route; a student and an instructor signing in look
   identical from the login form's perspective. The difference is entirely
   in what the signed-in session can reach.
4. **Route gating for students.** `src/proxy.ts` and the root layout
   currently assume every signed-in user is some flavor of instructor and
   route them into the instructor shell (`src/components/layout/sidebar.tsx`
   and friends). A `student`-role session needs to land somewhere else
   entirely — most simply, redirect straight to `/archive/[their-own-
   studentId]` and hide the instructor sidebar for that role the same way
   it's already hidden on grading/public routes
   (`isGradingRoute`/`isPublicRoute` in `sidebar.tsx`).
5. **"My archive" page.** A thin wrapper around the existing
   `/archive/[studentId]` page (`src/app/archive/[studentId]/page.tsx`) —
   or reuse it directly, resolving `studentId` from the signed-in user's
   `students.userId` link instead of a route param, so a student can't
   simply edit the URL to browse someone else's `studentId`. (`archive.view`
   already blocks that at the authorization layer regardless — `ctx.isOwn
   StudentRecord` only ever matches the caller's own linked record — but the
   UI shouldn't invite the attempt via an address bar that looks editable.)

## Deliberately not addressed here

- Whether a student can see annotations/markup on their own work, or only
  scores and feedback text. `getStudentArchive()` currently returns an
  annotation *count*, not the annotation content — that's a separate,
  smaller decision to make when this is actually built.
- Whether TAs (course role, not global role) can grant or revoke a
  student's own account access — out of scope; account lifecycle stays
  admin-only, matching how instructor accounts already work.
- Any of the "Probably never" items from `docs/accounts-and-courses.md`
  (announcements, discussions, calendar) — unaffected by this.
