# Bugs

Known issues in the art reviewer, found through use. Close an item by
deleting it once fixed and verified.

---

## Video proxies fail to open in Chrome — root cause found, fix in place, needs live verification

Some uploaded videos never play back in the reviewer — Chrome reports
`FFmpegDemuxer: open context failed` (`video error 4` /
`MEDIA_ERR_SRC_NOT_SUPPORTED`), even though `ffprobe` reads the same
file as a perfectly normal H.264/MP4. Two false leads got ruled out
along the way (worth keeping in mind if this ever looks similar
again): it isn't file corruption (regenerating the proxy from scratch
produces a byte-identical file that fails the same way), and it isn't
a Chrome version regression (the proxy plays fine when *fully
downloaded first* — local `file://`, or fetched to a Blob then handed
to a `<video>` — in the very same Chrome that fails on a live
streaming load from the server).

**Actual root cause: the all-intra proxy encode (`-g 1`, every frame a
keyframe) bloats file size 3-6x, and Chrome's native `<video>` element
loads the whole thing as one open-ended Range request. On a real
(non-LAN) connection a large proxy — 328MB for a 3.4-minute clip in
one repro — stalls or times out mid-transfer, which Chrome reports as
a generic demuxer error rather than a network failure.** Confirmed via
server-side request logging during a live reproduction: the small
(8.9MB) proxy usually got through in one shot, the large (328MB) one
took a long time and then failed, with a retry resuming partway
through rather than restarting — classic stalled-transfer behavior.
Also confirmed serving the *original* file directly (already H.264,
no proxy) loaded with no error, cementing that the container itself
was never the problem.

**Fix applied:**
- `makeVideoProxy()` now uses a ~1-second keyframe interval instead of
  every-frame, cutting proxy size dramatically while keeping scrub
  latency imperceptible (`packages/art-review/src/server/ingest.ts`)
- Ingest now runs eagerly right after upload (`after()` in
  `uploadSubmission()`/`uploadSubmissionSequence()`,
  `src/actions/submissions.ts`) instead of lazily on first review-page
  open, so review sessions never wait on a transcode
- One genuinely unrelated bug found and fixed along the way: an
  uncaught-exception race in the Range-serving stream (`toWeb()` in
  `range.ts`) that could corrupt/abort in-flight video responses under
  normal scrubbing — confirmed gone from server logs after the fix

**Not yet done:** regenerate both test proxies with the new GOP
setting and confirm live playback on `cs-1017245.cs.byu.edu` (Kate
Brown / Trevor Ely, assignment 2) before closing this out.

Likely files:
- [packages/art-review/src/server/ingest.ts](packages/art-review/src/server/ingest.ts) — `makeVideoProxy()`, keyframe interval
- [packages/art-review/src/server/range.ts](packages/art-review/src/server/range.ts) — `toWeb()`, the stream-race fix
- [src/actions/submissions.ts](src/actions/submissions.ts) — eager `ensureIngested()` on upload
- [src/actions/review.ts](src/actions/review.ts) — `ensureIngested()`

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
