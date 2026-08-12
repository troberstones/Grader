# Security notes

Written 2026-08-12, when the rubric gained a dock beside the art reviewer.

This is a note, not a claim. Grader currently has **no authentication of any
kind** — no login, no session, no middleware. Anything that can reach the port
can read and write every grade. That is a deliberate trade for a single-
instructor tool on a studio LAN, and it is the thing to fix first if any of the
assumptions below stop holding.

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

## Known gaps

Roughly in the order they'd matter if the tool left the studio:

1. **No authentication.** Any device on the subnet can open any assignment and
   change grades. There is not even a shared password.
2. **`allowedDevOrigins` uses subnet wildcards** (`192.168.86.*` and friends, in
   `next.config.ts`). Necessary because DHCP moves the studio machine between
   sessions, but it means any host on those subnets is a permitted origin.
3. **No authorization model.** `author.id` is hard-coded to `"instructor"` in
   the review route. The stroke schema already carries `author_id` per stroke,
   so peer critique is a migration away — but visibility rules and moderation
   do not exist yet, and nothing distinguishes one author from another.
4. **The follower has no way to verify the master.** Whoever posts to
   `/api/sync` first with `playback-master` is the master. On a trusted LAN this
   is fine; on an open network it is a hijack.
5. **Student media is served without a check.** `/api/review/media/[mediaId]`
   and `/api/submissions/[id]/file` will hand a submission to any requester.

## What is already fenced off

- `/api/review/diagnostics` returns 404 unless `NODE_ENV === "development"`,
  caps the body at 512 KB, and rebuilds the filename from a sanitised stem, so
  it cannot be used to write outside `storage/diagnostics/`.

## Before this is exposed to anything but the studio LAN

At minimum: put an auth check in middleware covering every `/assignments` and
`/api` route, drop the origin wildcards to specific hosts, and decide what a
student is allowed to see before `author.id` stops being a constant.
