# Testing the art review module

## Start

```bash
cd ~/Documents/Dev/grader
npm run dev
```

`predev` re-syncs the module into `node_modules` automatically, so edits under
`artReviewModule/src` take effect on restart. After editing the module while the
server is already running, `npm run sync:review` then let HMR pick it up.

Open **http://localhost:3000/assignments/22/review-v2** and pick a student from
the sidebar.

Student **Wright, Merlin** (assignment 22) has a deliberately mixed playlist:
an MP4 (176 frames), a layered PSD, a 3-page PDF, and a JPEG — one of each path.

## Prepare media ahead of time

The first open of a student transcodes an all-intra proxy, which takes a couple
of seconds. To warm a whole assignment first:

```bash
npm run review:ingest -- 22
```

Derivatives land in `storage/review/` and are reused forever after.

## What to try

**Formats** — step through the four files with the file chips at the top, or
PgUp/PgDn. Video, PSD, PDF and JPEG should each open without a reload.

**Timeline** — scrub the video. Ticks are annotated frames. The grey fill shows
how much of the clip is cached.

**Loop / bounce** — press `L` to cycle off → loop → bounce. Bounce should play
forward then backward smoothly, not stutter. If it stutters, the WebCodecs path
failed and it fell back to `<video>` — a notice appears bottom-left saying so.

**Flip while playing** — press `F` mid-playback. The image mirrors instantly and
playback never pauses. `Shift+F` flips vertically, `R` rotates.

**Annotate** — draw with the pen. Tools, colours, widths and undo are in the
rail down the right-hand side, where they stay reachable on a tablet. A note
belongs to the frame it was drawn on and shows on that frame only, so at 24 fps
it flashes past in 42 ms during playback — `[` and `]` jump between annotated
frames, and "Stop on notes" pauses playback when one is hit. Those are how you
read notes back, not the playhead.

**PSD layers** — open the PSD, switch the panel from Composite to Stack, toggle
layers, hit `S` on a layer to solo it. The `≉` marker means a blend mode that
cannot be reproduced in the shader; `fx` means an adjustment layer baked into
the composite.

**Value check** — `V` desaturates. `G` cycles composition guides.

**Layout** — the drawing rail is pinned to the right of the stage, so it never
scrolls away the way a bar under the transport did. Resize the window and watch
the stage: it grows and shrinks, keeps a 320 px floor, and nothing is allowed to
paint over the timeline. Below the floor the panel scrolls rather than overlap.

## Multi-device / master mode

1. Note the LAN address printed by `next dev` (e.g. `http://192.168.86.41:3000`).
   `allowedDevOrigins` already covers `192.168.86.*`, `192.168.1.*`, `10.55.30.*`
   and `*.local`, so DHCP changing the last octet will not break it.
2. Open the same review URL on the iPad and on a second browser window.
3. Both start as **followers**. Press **Take control** (or `M`) on the iPad.
4. From the iPad: scrub, play, switch files. Every other screen follows.
5. Draw on either device — annotation is independent of who holds control, so a
   follower can mark up the projector feed.
6. `Alt + drag` is the laser pointer: transient, broadcast, never stored.
7. **Follow view** (checkbox) additionally mirrors zoom and pan. Leave it off
   for the iPad, on for a projector.
8. **Break away** browses independently; **Rejoin** snaps back.

Only tick **Audio** on one machine, or the room echoes.

## Latency

Read the round-trip figure in the header (`… ms`, next to the peer count) — it
is a real ping/pong against the master, so it tells you what your network is
actually doing.

Measured on this machine, two clients through the server on loopback:

| Path | Median |
|---|---|
| POST → server → SSE → receive (raw) | 8.6 ms |
| Master click → follower state updated | 18 ms |

Add your WiFi round trip on top of that for the iPad: ~5 ms on clean 5 GHz,
20–100 ms on congested 2.4 GHz or with iOS power saving. If the header shows
more than ~60 ms, the network is the problem, not the code — try 5 GHz, and
keep the iPad's screen awake.

**Latency does not affect playback accuracy.** A follower computes its own
playhead from the master's timestamp, so a slow link delays when it *starts*
responding, not how well it tracks afterwards. Verified: with the master's tab
suspended entirely, a follower still advanced 25 frames per second on a 25 fps
clip. Latency is only directly visible when scrubbing, where you see the
follower move one round trip later.

To go materially lower you would replace SSE+POST with a WebSocket (removes the
POST leg, roughly halves it) or a WebRTC data channel (peer-to-peer, no server
hop, ~2–10 ms on a LAN). Both sit behind `ReviewChannel` and change nothing
above it.

## Memory

The header shows `cache N/M MB` — decoded frames across every open file, for the
whole tab. It is capped well below physical RAM on purpose: a browser tab is not
the machine, and multi-gigabyte frame caches swap the machine while the tab
still thinks it is fine. If that number pins at its ceiling, the clip is running
as a sliding window rather than a full flipbook. That is the designed
degradation, not a failure.

Watch actual pressure with:

```bash
vm_stat 1
```

## Automated checks

```bash
cd ~/Documents/Dev/artReviewModule
npm test          # 43 unit tests: fold/bounce math, stroke codec, reducer, clock, budgets
npx tsc --noEmit  # module typecheck
```

Ingest paths, against real files:

```bash
node test/make-fixtures.cjs                       # generates a layered PSD + 3-page PDF
node test/ingest-smoke.cjs "$PWD/test/.fixtures/layered-test.psd"
```

## Known state

Verified in the browser:

- Video renders and plays (176-frame clip, fps auto-detected, WebCodecs frame
  cache); loop wraps correctly.
- Flip mirrors the image *and* its annotations together, mid-playback.
- Drawing round-trips: stroke → binary codec → SQLite → reload → decoded,
  re-rendered in place, with the timeline marker and prev/next-annotation
  navigation landing on the right frame. A 15-point stroke stored as **57 bytes**.
- PSD layer stack: tree, group nesting, hidden layers, solo, multiply blending
  over transparency, unsupported-blend flags.
- PDF pages render and step as frames.
- Frame cache stayed at 348 MB for a 176-frame 1080p clip (stepped down to
  960×540 automatically) rather than the multi-gigabyte allocation that was
  swapping the machine.

Also verified headlessly: build, typecheck on both projects, 43 unit tests,
ingest of mp4/mov/jpg/psd/pdf against real submissions, HTTP Range serving
(206 / suffix / open-ended / 416 / 304), the SSE channel and server actions.

Multi-client sync, verified with two browser tabs:

- Taking control on one flips the other to "Following <name>".
- Scrubbing on the master moves the follower to the same frame.
- Play/pause propagates, and follower transport controls disable.
- Switching file switches it on the follower too, layer panel and all.

- Continuous playback: a follower advanced 63 → 88 → 113 over two seconds on a
  25 fps clip — exactly 25 frames per second — while the master's tab was
  suspended and sending nothing. The clock projection is doing the work.
- Message rate at idle: 10 messages per 15 s across two clients. (It was 1,365:
  every `hello` replied with a `hello`, so two peers volleyed at network speed
  and real transport events queued behind the noise.)

Annotation across clients, verified with two browser windows:

- Live ink: the line appears on the other screen *while* it is being drawn,
  unbroken. On release it becomes a committed stroke in place, with no gap and
  no duplicate.
- Committed strokes cross in both directions, and land on a paused screen —
  they no longer wait for the next thing to repaint the canvas.
- Erase and undo propagate, and actually delete: erase on one screen removes the
  note on the other, the timeline tick goes with it, and it stays gone after a
  reload.
- The laser pointer (`Alt + drag`) tracks on the other screen and fades on its
  own.

Note that one instructor signed in on two devices is the normal case, not an
edge case — the iPad and the Mac are the same account. Anything that identifies
a *device* has to use the client id, never the author id.

One submission in assignment 22 (`MailenCruz_SkinSculpt.mp4`) is a corrupt
upload from April — truncated, no `moov` atom. It now shows an explicit
"can't be opened" panel naming the reason, rather than failing to decode.
