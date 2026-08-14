# Security notes

Written 2026-08-12, when the rubric gained a dock beside the art reviewer.

> **Updated 2026-08-14.** Grader now has authentication: invite-only accounts,
> server-side sessions, and a gate covering every page. What has *not* happened
> is the authorization sweep — **every `/api` route is still open**. Read "Known
> gaps" below before assuming anything is protected. The original note follows,
> amended.

This is a note, not a claim. Grader has authentication as of 2026-08-14, but
until the authorization sweep lands, anything that can reach the port can still
read and write every grade **through the API**. That was a deliberate trade for
a single-instructor tool on a studio LAN, and it stops being acceptable the
moment more than one instructor has an account.

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

1. **~~No authentication.~~ Pages are gated; the API is not.** `src/proxy.ts`
   redirects unauthenticated page requests, and the root layout re-checks the
   session against the database so a forged cookie fails. But the proxy matcher
   deliberately excludes `/api`, and no route handler checks a session. Anything
   on the subnet can still read and write grades through
   `/api/submissions/*`, `/api/review/*` and `/api/sync/*`. This is the single
   largest remaining gap and is phase 3 in
   [accounts-and-courses.md](accounts-and-courses.md).
2. **`allowedDevOrigins` uses subnet wildcards** (`192.168.86.*` and friends, in
   `next.config.ts`). Necessary because DHCP moves the studio machine between
   sessions, but it means any host on those subnets is a permitted origin.
3. **Authorization exists globally, not per course.** `can()` in
   `src/lib/auth/roles.ts` decides on a *resource*, and global roles
   (admin / instructor / assistant) are enforced — the admin console is
   genuinely admin-only. But `course_members` does not exist yet, so every
   active instructor can reach every course. The assumption is greppable as
   `COURSE_SCOPING_PENDING`.

   `author.id` is still hard-coded to `"instructor"` in the review route, so
   strokes do not yet carry a real author even though the schema has the column.
4. **The follower has no way to verify the master.** Whoever posts to
   `/api/sync` first with `playback-master` is the master. On a trusted LAN this
   is fine; on an open network it is a hijack.
5. **Student media is served without a check.** `/api/review/media/[mediaId]`
   and `/api/submissions/[id]/file` will hand a submission to any requester.

6. **Sessions travel over plain HTTP.** Cookies are `httpOnly` and
   `sameSite=lax` but not `secure`, because the studio LAN has no TLS and a
   secure cookie would simply never be sent. Set `SECURE_COOKIES=1` when this
   moves behind HTTPS — the flag is configuration, not a code change.

7. **No rate limiting on sign-in.** Failures are generic and constant-time-ish,
   but nothing slows down repeated attempts.

## What is already fenced off

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

## Before this is exposed to anything but the studio LAN

At minimum: put an auth check in middleware covering every `/assignments` and
`/api` route, drop the origin wildcards to specific hosts, and decide what a
student is allowed to see before `author.id` stops being a constant.
