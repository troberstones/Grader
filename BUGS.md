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

**Partially addressed for grades specifically** (checked against code, not
just commit messages): `c7361d3` fixed autosave races where a pending save
could fire ~1.5s later against whichever student the panel had already moved
on to, and `e1cb754` wired `saveShareGrade`'s existing stale-conflict
detection (`baseUpdatedAt`) end to end so a real conflict surfaces in the UI
instead of silently losing a save. That covers grade writes racing each
other. It does **not** cover the broader claim in this item — whether
selecting a student, an in-progress annotation stroke, or other session UI
state leaks or interferes across two concurrent professor sessions — which is
still unverified.

`src/actions/annotations.ts` (the Fabric-based annotation system) no longer
exists — deleted as dead code in `ade2516` along with review-v1, the only
thing that used it. The live annotation path is the stroke-based system in
`src/actions/review.ts` (`getStrokes`/`appendStrokes`/`deleteStrokes`) plus
`packages/art-review`'s `useSession`/`useAnnotations`/`ReviewChannel`, which
is where a concurrent-annotation investigation should actually look.

Likely files:
- [src/components/shared/session-mode.tsx](src/components/shared/session-mode.tsx)
- [src/components/shared/grading-shell.tsx](src/components/shared/grading-shell.tsx)
  (per `docs/open-threads.md`, recently touched for a "sync-pause fix" —
  check whether it's relevant here)
- [src/actions/review.ts](src/actions/review.ts) — strokes (live annotations)
- [packages/art-review/src/react/useSession.ts](packages/art-review/src/react/useSession.ts),
  [packages/art-review/src/react/useAnnotations.ts](packages/art-review/src/react/useAnnotations.ts)
- [src/hooks/use-rubric-grading.ts](src/hooks/use-rubric-grading.ts) — grade
  autosave/conflict handling already fixed (see above)

## Checkboxes (e.g. audio) retain focus after clicking

Clicking a checkbox in the viewer (e.g. the audio toggle) leaves it
focused, which then intercepts keyboard input meant for the viewer —
e.g. pressing space toggles the checkbox again instead of play/pause.
Checkboxes should blur themselves after being clicked so hotkeys keep
routing to the viewer.

Still open — checked against current code. `fca0ef5` narrowed
`isTypingTarget` so a focused **button** no longer swallows every shortcut
(only Space, which is a focused button's own native activation key), but a
checkbox is still tagged `INPUT`, which `isTypingTarget` treats as a typing
target unconditionally — so every shortcut, not just Space, still goes
nowhere while the Audio or Sharpen-on-pause checkbox holds focus. The
previously-listed files (`src/components/review/canvas-video-player.tsx`,
`src/components/review/video-player.tsx`) no longer exist — they were
review-v1-only and deleted in `ade2516`. The live checkboxes are in
ArtReviewer.tsx itself.

Likely files:
- [packages/art-review/src/react/ArtReviewer.tsx](packages/art-review/src/react/ArtReviewer.tsx)
  — the Audio and Sharpen-on-pause `<input type="checkbox">`s
- [packages/art-review/src/react/keymap.ts](packages/art-review/src/react/keymap.ts)
  — `isTypingTarget`/`isButtonTarget`

## No way to collapse the Photoshop layer panel

The Photoshop layer view has no collapse/expand control, so it permanently
eats horizontal space that could go to the image itself.

Still open — checked: `LayerPanel.tsx` renders at a fixed `width: 240` with
no collapse/expand state anywhere in the component.
`review-v1/review-client.tsx` (previously listed here) no longer exists,
deleted in `ade2516`.

Likely files:
- [packages/art-review/src/react/components/LayerPanel.tsx](packages/art-review/src/react/components/LayerPanel.tsx)
- [src/app/api/review/layers/[submissionId]/route.ts](src/app/api/review/layers/[submissionId]/route.ts)
  (serves the layer manifest)
- [src/app/assignments/[assignmentId]/review/review-client.tsx](src/app/assignments/[assignmentId]/review/review-client.tsx)
