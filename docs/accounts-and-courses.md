# Accounts, courses, and terms

Written 2026-08-14, planning the move from a single-instructor tool to a
multi-professor one.

Companion to [security.md](security.md), which records what is currently
unprotected. This document records what replaces it, and — more importantly —
which decisions are cheap now and expensive later.

## Scope, as decided

Three questions were settled before design:

1. **Instructors only, for now.** Students stay roster records, not users.
   But student submit-and-view must remain addable without an identity merge.
2. **The authoritative gradebook is undecided.** Learning Suite may stay the
   system of record, or grader may take it over. Nothing should assume either.
3. **Studio LAN while testing, departmental server eventually.** HTTP now,
   HTTPS later, without a security rewrite in between.

Everything below follows from wanting all three to stay true.

## The five things that must be right now

These are the choices that are one column or one function signature today, and
a migration across every call site later. Nothing else on the roadmap is
load-bearing in the same way.

### 1. Capability checks take a *resource*, not a course id

The instinct is `assertCourseAccess(user, courseId)`. Don't. Write:

```ts
can(user, capability, resource): boolean
// resource: {kind: 'course'|'assignment'|'submission'|'grade', id: number}
```

When students arrive they are not members of a course — they are the *subject*
of particular submissions and grades. A check shaped around course membership
cannot express "may read this one submission because it is theirs," so adding
students means rewriting every call site. A check shaped around a resource
slots them in as one more rule.

This is the single most consequential decision in the document.

### 2. Media routes resolve ownership even while the answer is always yes

`/api/review/media/[mediaId]` and `/api/submissions/[id]/file` currently serve
any file to any requester. When they gain a check, that check must walk
`media → submission → assignment → course` and ask `can()`. Build that walk now,
while every instructor passes it. Skip it and student access later is a rewrite
of the file-serving layer rather than one added rule.

### 3. `grades.publishedAt`, nullable, from the start

*Graded* and *visible to the student* are different facts. Even with no student
login, record the second one. There are already 649 grade entries in the
database with no notion of whether they were ever meant to be seen; every one
added before this column exists is another row you will have to guess about
retroactively.

No UI required today. One column, always null.

### 4. `students.userId`, nullable

`students` is the roster record, synced from Learning Suite and keyed by netId.
`users` is a login. They are not the same table and should not become the same
table — but the link between them should exist before it is needed, so that
students logging in is a population step rather than a merge of two identity
systems.

`users.netId` exists for the same reason: it is how CAS/SSO will eventually
replace local passwords without a migration.

### 5. One grade-computation module

Today a course grade is a sum of points. That is a *policy*, and it belongs in
one file with one entry point:

```ts
computeCourseGrade(courseId): { perAssignment, total, letter? }
```

Not scattered `sum(points)` expressions across pages and exports. If Learning
Suite stays authoritative this file stays trivial forever. If grader takes over,
weighted categories and letter scales and drop-lowest all land inside it and
nothing outside changes. Add `courses.gradingPolicy` as a nullable JSON column
to hold the eventual configuration.

Also add `assignments.sortOrder` and a nullable `assignments.categoryId` now —
`sortOrder` is needed for course-copy fidelity regardless, and the category
column is where weighting attaches if it ever does.

## Identity

```ts
users     id, email (unique), netId (unique, nullable), name, passwordHash,
          globalRole: 'admin'|'instructor'|'assistant',
          status: 'invited'|'active'|'disabled', createdAt, lastLoginAt
sessions  id, tokenHash, userId, expiresAt, createdAt, userAgent, ip
invites   id, email, globalRole, tokenHash, invitedBy, expiresAt, acceptedAt
```

- **Server-side sessions, not JWT.** Disabling an account must log it out
  immediately. A JWT denylist is a session table with extra steps.
- **Opaque 32-byte token in the cookie; only its SHA-256 is stored.** Database
  read access must not equal session forgery. This costs nothing to do now and
  is the kind of thing never retrofitted.
- **`node:crypto` scrypt** for passwords. Built in; argon2id is marginally
  stronger but costs a native dependency.
- **Cookie flags from config, not hardcoded.** `secure` follows the deployment,
  `httpOnly` and `sameSite=lax` always. HTTP on the LAN is a deliberate
  concession for testing; it must not be an assumption baked into auth code.
- **No password is weakened for the LAN phase.** The trusted network is why
  there is no TLS, not a reason to store credentials carelessly.

### Global role means exactly one thing

Whether you may create a course. `admin` / `instructor` / `assistant`.
Everything else is per-course, because that is where the real distinctions are.

```ts
courseMembers  courseId, userId, role: 'owner'|'instructor'|'ta'|'observer',
               sectionId (nullable), addedAt
```

|            | roster | assignments & rubrics | grade | publish | members |
|------------|:------:|:---------------------:|:-----:|:-------:|:-------:|
| owner      | ✎ | ✎ | ✎ | ✎ | ✎ |
| instructor | ✎ | ✎ | ✎ | ✎ | — |
| ta         | 👁 | 👁 | ✎ | — | — |
| observer   | — | 👁 | — | — | — |

TAs are the reason course roles exist at all. A TA who can grade but cannot
quietly reweight a rubric is the most valuable boundary in the system.

**Guest critic** is worth adding as a variant of observer: time-boxed access to
one assignment's review session, no gradebook. Visiting critics are a real
fixture of art programs, and the sync bus already exists to put them on the
projector.

## Account creation

- **Invite-only.** Admin enters an email and a global role; a single-use link
  lets the professor set their own password. No self-signup, and no admin ever
  knows a password.
- **First-run bootstrap.** With no users in the database, `/login` becomes
  "create the first administrator." Never seed a default password — a known
  default on a studio LAN is worse than no auth, because it looks like auth.
- **Admin console** at `/admin/users`: invite, disable, re-enable, change global
  role, transfer course ownership, force-logout.

Login is rate-limited two ways: per-account lockout (5 failed attempts locks
it for 15 minutes) and a same-shaped per-IP throttle. Both return one generic
failure message, except a locked account, which is named explicitly — see
`src/lib/auth/lockout.ts` and `docs/security.md`.

## Terms

`courses.semester` is free text and has already drifted — the live database
holds `Winter 2026`, `winter 2026`, `Spring 2026`, and `last year`.

```ts
courses  year: integer,          // 2026
         term: 'winter'|'spring'|'summer'|'fall',
         startDate, endDate      // drives due-date rebasing on copy
```

Sort by `year * 10 + termOrder`, with `winter:1, spring:2, summer:3, fall:4`.
An explicit ordinal, because alphabetical sorting puts Fall first and is wrong
every single year.

The migration is a one-time parse of five rows.

## Course copy: versions, not instances

A copied course is independent from the moment it exists. There is no shared
parent row and no inheritance — the professor is expected to revise assignments
and rubrics for the new offering, which is the whole point.

```ts
courses  lineageId: integer,     // the first course's id; the family key
         copiedFromId: integer   // provenance, one hop back
```

`lineageId` exists only so the dashboard can say "CSANM 354 — 4 offerings" and
so this year's rubric can be diffed against last year's. It confers nothing.

**Copies:** assignments, rubrics (deep-cloned), assignment order and categories,
course settings.

**Does not copy:** enrollments, submissions, grades, annotations, strokes,
review media.

**Must be cleared:** `lmsCourseId`, `lmsAssignmentId`, `lmsGradebookId`,
`lmsDiscussionUrl`. This is the one part of the feature that can damage data
outside the application — carry those across and the first grade push writes
into last year's Learning Suite gradebook.

**Due dates** are stored on copy as day-offsets from `startDate` and rebased
onto the new term. Absolute dates from last year are always wrong; clearing them
means re-entering fifteen dates by hand.

The operation gets a **preview screen** listing exactly what will and will not
come across, with a checkbox per assignment. This is the difference between a
feature that gets trusted and one that gets run once.

## Rubrics need a model change before copy is safe

Rubrics are currently global and shared by reference. Two consequences:

**Copying breaks.** Deep-cloning on every copy leaves four near-identical
"Animation Principles" rubrics after four years. Sharing by reference instead
means editing this year's rubric silently changes what last year's grades meant.
Neither is acceptable.

**Editing a graded rubric is broken today.** `updateRubric` in
`src/actions/rubrics.ts` deletes and re-inserts all criteria and levels, but
`grade_entries.criteria_id` references them and `foreign_keys = ON`. Five
rubrics currently carry grade entries — "Gingerbread Final" has 210 — and
editing any of them throws a foreign-key failure.

**Decided: a copied rubric is a live reference that can be overridden per
criterion, and severed on demand.**

```ts
rubrics          parentRubricId (nullable), severedAt (nullable)
rubricCriteria   originCriterionId (nullable), linked: 0|1
```

The child gets its **own full set of criterion and level rows** at copy time —
not a virtual view resolved against the parent. This matters: `grade_entries`
reference criterion and level ids, and if a 2027 grade pointed at a criterion
owned by the 2026 rubric, editing 2026 would rewrite what 2027's grades meant.
Rows are local; the *link* is the metadata.

That makes each operation cheap and obvious:

- **Override** — editing one criterion in the child sets `linked = 0` on that
  criterion alone. The rest keep tracking upstream.
- **Sever** — clears `parentRubricId` and sets `linked = 0` everywhere. No data
  moves, because the data was always local. One-way; re-linking would mean
  matching criteria back up by guesswork, so don't offer it.
- **Propagate** — editing the parent updates linked children in place.

### The rule that protects grades

**Propagation stops at grades.** When a parent criterion changes, for each
linked child criterion:

- no grade entries against it → update in place, silently;
- grade entries exist → **do not touch it.** Mark it `upstream changed` and let
  the professor accept the change or keep theirs.

Rewriting a criterion that has already been graded against changes what a score
meant after it was given. Mid-semester, a colleague's edit to last year's rubric
must not silently alter the one you have already graded twenty students on.

### This makes fixing `updateRubric` mandatory

`updateRubric` currently deletes and re-inserts every criterion and level. With
links, criterion ids must be **stable** — both `grade_entries.criteria_id` and
`origin_criterion_id` point at them. It has to become a real diff: update in
place, insert what's new, delete what's gone, and refuse to delete anything a
grade entry references.

This also fixes the foreign-key failure above. The two problems have one fix.

### UI

A linked rubric shows a badge — *Linked to Shading (Winter 2026)* — and each
criterion shows one of `inherited`, `overridden`, or `upstream changed`. One
Sever button, with a confirmation that says plainly what stops happening:
existing content is unchanged, updates stop arriving, and it cannot be undone.

Note the distinction from the existing `duplicateRubric`, which makes an
independent copy and should keep doing exactly that. **Duplicate** and **Link**
are different verbs and the library should say so.

## Course scope: everything except rubrics

Selecting a course should narrow the application to that course. Assignments,
roster, gradebook and submissions are all course-scoped. **Rubrics are the
deliberate exception** — they are a cross-course library and must stay
browsable, because reusing last year's Shading rubric in a new course is the
entire point of having a library.

**Put the course in the route, not in client state.**

```
/courses/[courseId]/assignments      ← replaces the global /assignments
/courses/[courseId]/roster           ← already exists
/courses/[courseId]/gradebook
/rubrics                             ← stays global
```

URL-as-truth is the right call for three reasons: it survives a reload, it is
linkable to a colleague, and it works with server components without hydrating a
selection from client state. A cookie can remember the last course so top-level
navigation lands somewhere sensible, but the URL decides what is shown.

The payoff is on the authorization work in phase 2: a course-prefixed route
means `can(user, 'view', course)` is **one check in one layout**, rather than a
membership filter repeated across every list query. Routes that are not
course-scoped are the ones that will leak, so having only one of them —
`/rubrics` — is a feature.

`getAllAssignments()` and the current group-by-course page then become the
dashboard's cross-course view, which is the only place that view is genuinely
wanted.

### Browsing other people's rubrics

Once there are several professors, the library needs an owner and a visibility:

```ts
rubrics  ownerId, visibility: 'private'|'department'
```

with filters for **Mine / Used in this course / Department / All**. "Used in
this course" is derived from the assignments referencing it — no `courseId`
column on rubrics, because a rubric genuinely belongs to a library rather than
to a course.

Department visibility plus the link-and-override model above is also how one
professor adopts another's rubric and diverges from it, which is a better answer
to sharing than emailing JSON around.

## The dashboard

`/` becomes courses grouped **Current / Upcoming / Past** from `year` + `term`.
Each card carries the counts that decide what to do next — students,
assignments, **ungraded submissions** — and the actions: open gradebook, new
assignment, copy to new term. Past collapses behind a disclosure; archived is
hidden.

The ungraded count is a join across `submissions` and `grades` per course.
Index it now rather than discovering it at thirty courses.

## The v1 data, and why there is no migration

The 103 grades, 649 grade entries and 14 rubrics in the database on
2026-08-14 were live testing. They do not proceed forward. The roster and
grades will be re-imported from Learning Suite when real courses start.

**Snapshot:** `storage/grader-2026-08-14-pre-v2.db`, taken with `VACUUM INTO`
(which does not touch the source and correctly folds in the WAL). It holds
everything: 103 grades, 649 entries, 14 rubrics, 245 submissions, 985 strokes.
`ATTACH` it read-only from any SQLite session to query it.

Note that `/storage/` is gitignored, so this file is **not** backed up by
version control. It exists on one disk.

An earlier draft of this plan proposed carrying both grading models forward —
`rubrics.gradingModel: 'v1-points' | 'v2-percent'` — so that old grades stayed
interpretable alongside new ones. **That is no longer the plan.** With the v1
data disposable, dual semantics buys nothing and costs a permanent branch in
every grading path. Build v2 only; the snapshot is the archive.

What *does* survive from that analysis, because it was never really about
legacy data:

### Fork-on-edit is a live invariant, not an archive mechanism

A rubric criterion that has grade entries against it must not be edited in
place — not because old data is precious, but because **next semester it will
be this semester's data**. Editing a rubric mid-course changes what scores
already given were supposed to mean.

So: editing a rubric that has been graded against **forks a new version** and
re-points the assignment. `rubrics.versionOf` / `supersededBy`. Old rows stay
where they are, owned by the grades that reference them.

This is the same rule as the linked-rubric propagation guard above. One rule,
serving both.

### `courses.closedAt`

A closed course is read-only end to end: no grade writes, no roster changes, no
reachable rubric edits. Same pages, an *Archived — read-only* banner, mutations
hidden. Canvas calls this a concluded course, so it needs no explaining.

Also forward-looking rather than archival: it is what stops someone reopening
last spring and changing a grade that was exported to Learning Suite months ago.

### A warning worth keeping in the schema

`updateRubric` currently deletes and re-inserts every criterion and level, and
`foreign_keys = ON` makes that **throw** whenever grades exist. That failure is
a guard rail. If anyone ever "fixes" it by adding `ON DELETE CASCADE` or by
nulling `grade_entries.level_id`, grading history loses its level labels
silently, and nobody finds out until a student asks why their rubric is blank.

Fix it by forking. Never by cascading.

## Phase order

Each phase leaves the application working.

0. **Schema groundwork.** The five decisions above, plus `year`/`term`,
   `lineageId`, `courseMembers`, `closedAt`, and the rubric link columns. No
   term migration and no data backfill — the v1 rows are disposable, so this is
   a clean schema rather than an alteration. No visible change.
1. **The points model.** `validateRubric()` and `computeScore()` as pure,
   unit-tested functions, plus band edges anchored to letter grades. Pure logic,
   independent of the grading UI that is still moving. See
   [rubric-authoring.md](rubric-authoring.md).
2. **Authentication.** `users`, `sessions`, `invites`, `/login`, first-run
   bootstrap, admin console, a coarse route gate.
3. **Authorization. Done 2026-08-14.** `can()` at every server action and
   same-origin route handler — the media routes and the SSE subscribe in
   `/api/sync/[assignmentId]` included, once the studio confirmed the
   projector/follower machine does sign in. The one thing this phase did
   *not* close: `/api/ls-bridge/*` and `/api/submissions/upload` are called
   cross-origin by the Chrome extension, and a wildcard-CORS route cannot
   carry a session cookie by construction — no amount of `can()` fixes that.
   Recorded as a permanent gap in [security.md](security.md) #1, needing a
   machine credential (API key) as its own future feature.
4. **Course scoping, ownership, dashboard.** Move assignments under
   `/courses/[courseId]/`, which is what makes phase 3's checks cheap.
5. **Course copy**, with the preview screen.
6. **Rubric linking, override and sever**, including the fork-on-edit fix.

## Deferred, deliberately

Recorded so they are choices rather than oversights.

**Needed before this leaves the studio LAN:** enrollment state
(`enrolled|dropped|waitlisted` — dropping a student must not delete their
grades), storage paths that include the course, and soft-delete instead of
`deleteCourse`'s hard delete.

**Done:** an audit log covering grade changes and other security-sensitive
actions (`audit_log`, visible at `/admin/audit`), and daily backups of the
database that now holds password hashes (`grader-backup.timer`) — see
`docs/security.md`.

**LMS completeness:** a gradebook matrix, weighted categories and letter scales,
sections as entities, submission attempts and resubmission, late policy and
per-student extensions, timezone-aware due dates (they are currently strings),
CSV roster import and grade export, course export for handing a course to a
colleague.

**Probably never:** announcements, discussions, calendar. These defer to
Learning Suite, which is what `lmsDiscussionUrl` already does.
