# Bugs

Known issues in the art reviewer, found through use. Close an item by
deleting it once fixed and verified.

---

## Professor separation: seeing other professors' courses

**Priority: security/data leak — investigate first.** Logging in as one
professor/administrator shows another professor's courses, and vice
versa. Course access should be scoped per-user.

What's confirmed so far: the main courses-list query, `getCourses()` in
`src/actions/courses.ts`, does filter by `course_members` membership for
non-admin users (via `myCourseIds()`), which looks correct on its face.
Leads to check next:
- Whether the affected accounts have `globalRole === "admin"` —
  admins intentionally see every course by design
  (`src/lib/auth/roles.ts`, `course.view` capability check)
- Whether a call site is using `getCoursesForCopy()` (deliberately
  broader — includes any `visibility: "department"` course from any
  owner) where it should be using the membership-scoped `getCourses()`
- Whether `createCourse()` is reliably inserting the `owner` row into
  `course_members`, or whether stale/missing membership rows are
  causing scoping to fail

Likely files:
- [src/actions/courses.ts](src/actions/courses.ts) — `getCourses()`,
  `getCoursesForCopy()`, `myCourseIds()`, `createCourse()`
- [src/lib/auth/roles.ts](src/lib/auth/roles.ts) — `can()`, `course.view`
  capability
- [src/db/schema.ts](src/db/schema.ts) — `courses` (has `visibility`,
  no direct owner column) and `course_members` (actual per-course
  ownership/role table)
- [docs/accounts-and-courses.md](docs/accounts-and-courses.md) — documents
  the intended scoping model ("Course scope: everything except rubrics",
  "Browsing other people's rubrics")

## Concurrent professor logins can interfere with each other

When two professors are logged in and grading/reviewing at the same
time, their sessions/state shouldn't interfere with each other (e.g.
one professor's grading session, selected student, or in-progress
annotation affecting what the other sees or overwriting their work).
Related to the course-separation bug above, but distinct: this is about
concurrent-session isolation and conflict handling, not just data
scoping. Needs investigation into what state is shared server-side vs.
per-session, and whether concurrent writes (e.g. two people grading the
same submission, or annotation/grade saves racing) are handled safely.

Likely files:
- [src/components/shared/session-mode.tsx](src/components/shared/session-mode.tsx)
- [src/components/shared/grading-shell.tsx](src/components/shared/grading-shell.tsx)
  (per `docs/open-threads.md`, recently touched for a "sync-pause fix" —
  check whether it's relevant here)
- [src/actions/annotations.ts](src/actions/annotations.ts)
- [src/actions/review.ts](src/actions/review.ts)

## Checkboxes (e.g. audio) retain focus after clicking

Clicking a checkbox in the viewer (e.g. the audio toggle) leaves it
focused, which then intercepts keyboard input meant for the viewer —
e.g. pressing space toggles the checkbox again instead of play/pause.
Checkboxes should blur themselves after being clicked so hotkeys keep
routing to the viewer.

Likely files:
- [src/components/review/canvas-video-player.tsx](src/components/review/canvas-video-player.tsx)
- [src/components/review/video-player.tsx](src/components/review/video-player.tsx)

## No way to collapse the Photoshop layer panel

The Photoshop layer view has no collapse/expand control, so it permanently
eats horizontal space that could go to the image itself.

Likely files:
- [src/app/api/review/layers/[submissionId]/route.ts](src/app/api/review/layers/[submissionId]/route.ts)
  (serves the layer manifest)
- [src/app/assignments/[assignmentId]/review/review-client.tsx](src/app/assignments/[assignmentId]/review/review-client.tsx)
- [src/app/assignments/[assignmentId]/review-v1/review-client.tsx](src/app/assignments/[assignmentId]/review-v1/review-client.tsx)
