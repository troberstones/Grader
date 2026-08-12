# Art Review Module — Design

A standalone review/critique viewer that replaces `src/components/review/*` in grader.

Status: proposal. Nothing built yet.

---

## 1. What it has to do

| # | Requirement | Where it lands |
|---|---|---|
| 1 | Open pdf, png, jpg, psd, tiff + web video | §4 Ingest, §5 Sources |
| 2 | Flip between multiple files and types | §5 Playlist |
| 3 | HTML5 canvas | §6 Renderer |
| 4 | Color management | §9 |
| 5 | Timeline with scrubbing | §5, §7 |
| 6 | Remote control, master mode, all hosts follow | §8 |
| 7 | Annotation: multiple colors + pen widths | §7 |
| 8 | Annotations in DB, drawn by master *or* display host | §7 |
| 9 | Lightweight data for fast transfer | §7.2 stroke codec |
| 10 | Timeline shows annotated frames; visible during playback + scrub; cycle between them | §7.3 |
| 11 | Settable frame rate | §5 |
| 12 | Loop and bounce (ping-pong) | §5.3 |
| 13 | Flip H/V while playing or on a still | §6 (shader uniform) |

---

## 2. The one idea that makes this tractable

**Everything is a frame source, and position is `(fileIndex, frameIndex)`.**

A jpg is a 1-frame source. A 12-page pdf is a 12-frame source. A 4-second video at 24fps
is a 96-frame source. A png sequence is an N-frame source. A psd is a 1-frame source (or
N-frame, one per layer group, if we ever want that).

Once that holds, *every* feature below is written once and works on every media type:
timeline, scrubbing, loop/bounce, annotation-per-frame, annotation markers, next/prev
annotated frame, remote sync, flip, export. There is no "image mode" and "video mode" —
which is exactly the split that makes the current `review-client.tsx` (756 lines) and
`canvas-video-player.tsx` (1336 lines) hard to extend.

```ts
interface MediaSource {
  readonly kind: 'still' | 'pages' | 'video' | 'sequence'
  readonly frameCount: number
  readonly fps: number | null        // authored fps; null = not time-based
  readonly width: number             // media pixels
  readonly height: number
  readonly colorSpace: ColorSpaceInfo
  getFrame(i: number): Promise<TexSource>   // ImageBitmap | VideoFrame | HTMLVideoElement
  prefetch(from: number, to: number): void
  dispose(): void
}
```

Four implementations, added in this order:
`StillSource` → `PageSource` (pdf) → `VideoElementSource` (`<video>` + rVFC) →
`DecodedVideoSource` (WebCodecs, §5.4) / `SequenceSource`.

---

## 3. Packaging & the grader seam

Built as a self-contained package with **zero imports from grader**. Grader supplies data
through one adapter interface; the module never knows what a "student" or a "rubric" is.

```ts
export interface ReviewDataAdapter {
  listItems(contextId: string): Promise<ReviewItem[]>          // the playlist
  getStrokes(itemId: string, sinceSeq?: number): Promise<StrokeRecord[]>
  appendStrokes(itemId: string, s: StrokeInput[]): Promise<{ seq: number }[]>
  deleteStrokes(ids: number[]): Promise<void>
  getAnnotatedFrames(itemId: string): Promise<FrameMarker[]>
  channel: ReviewChannel                                        // §8
}

export function ArtReviewer(props: {
  adapter: ReviewDataAdapter
  contextId: string          // grader passes `assignment:{id}:student:{id}`
  author: { id: string; name: string; color: string }
  initial?: Partial<ViewerState>
  onPositionChange?: (p: Position) => void
}): JSX.Element
```

Grader mounts it at `/assignments/[id]/review` with a `ReviewDataAdapter` built from
its server actions. Old review page stays live until the new one wins. No big-bang cutover.

Internals are split so the hard parts are testable without a browser:
```
src/core/      state machine, bounce math, stroke codec, clock sync   (pure TS, unit tested)
src/render/    WebGL2 renderer, annotation overlay                    (needs canvas)
src/sources/   MediaSource implementations
src/react/     hooks + <ArtReviewer>, toolbars, timeline
src/server/    ingest pipeline helpers (ffprobe/ffmpeg/sharp/pdf), Range handler
```

---

## 4. Ingest — do not ask the browser to decode arbitrary files

This is the single biggest reliability win and it must come first. `ffmpeg`/`ffprobe` are
already installed on this machine; `sharp` is already in the dependency tree.

On upload, a job produces derivatives next to the original:

| Input | Problem | Derivative |
|---|---|---|
| `.mov` (ProRes/HEVC) | won't play in most browsers | all-intra H.264 mp4 (§5.5) |
| `.avi` | won't play, ever | all-intra H.264 mp4 |
| `.mp4` (H.264/AAC) | plays, but long GOPs make seek/reverse slow | all-intra proxy; original kept |
| `.psd` / `.psb` | browser can't read it | composite PNG + layer tree manifest; layer rasters lazily (§5.6) |
| `.tiff` | Safari only, unreliable | PNG |
| `.pdf` | fine via pdf.js | page count + poster only |
| `.png/.jpg/.webp` | fine | ICC-normalised copy if profile ≠ sRGB (§9) |
| any video | fps/duration unknown | `ffprobe` → fps, frameCount, duration, color tags |

Two things this fixes today:
- `SUPPORTED_EXTENSIONS` in `src/lib/constants.ts` advertises `.tiff` and `.avi`, neither
  of which a browser will reliably display. Uploads succeed, review shows nothing.
- `submissions.fps` / `frameCount` / `duration` columns exist but are populated from the
  client after playback starts. `ffprobe` at ingest makes them authoritative, which
  the timeline needs *before* the media loads.

New table rather than more columns on `submissions`:

```sql
CREATE TABLE review_media (
  id INTEGER PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  variant TEXT NOT NULL,        -- 'original' | 'proxy' | 'poster' | 'page' | 'composite'
  idx INTEGER NOT NULL DEFAULT 0,   -- page number for 'page'
  path TEXT NOT NULL, mime TEXT NOT NULL,
  width INTEGER, height INTEGER,
  fps REAL, frame_count INTEGER, duration REAL,
  color_primaries TEXT, transfer TEXT, icc_path TEXT,
  status TEXT NOT NULL DEFAULT 'ready'   -- 'pending' | 'ready' | 'failed'
);
```

**Range requests.** `src/app/api/submissions/[submissionId]/file/route.ts` reads the whole
file into a Buffer and returns it with no `Accept-Ranges`. Safari (i.e. the iPad) requires
byte-range support to play video at all, and scrubbing a 200MB file without it is hopeless.
A ~30-line streaming handler with `Range` parsing is a prerequisite for everything in §5.

---

## 5. Transport model

### 5.1 Playlist
`ReviewItem[]` — one entry per file for the current student, plus (optionally) reference
files pinned by the instructor. Position is `{ item: number, frame: number }`. Switching
item is a normal action, so it syncs to followers for free (requirement 6).

### 5.2 Frame rate
Three fps values, kept distinct:
- **authored fps** — from `ffprobe`, or 12/24 default for stills and pages.
- **display fps** — user override ("play this at 12"), per item, persisted.
- **wall-clock** — rAF; the engine drops/holds frames to hit display fps.

### 5.3 Loop / bounce — closed form
```ts
function fold(k: number, n: number, mode: LoopMode): number {
  if (n <= 1) return 0
  if (mode === 'off')  return Math.min(Math.max(k, 0), n - 1)
  if (mode === 'loop') return ((k % n) + n) % n
  const period = 2 * (n - 1)                    // bounce
  const p = ((k % period) + period) % period
  return p < n ? p : period - p
}
```
Closed form matters: a follower can compute its frame from a timestamp without replaying
state, which is what makes clock-synced playback in §8.3 work.

### 5.4 Video is a flipbook — decode to a frame cache

`<video>` cannot play backwards: `playbackRate` must be positive in every browser, so bounce
mode's reverse half can only be faked by seek-stepping. `currentTime` seeks land on the
nearest decodable point, not the frame you asked for, so scrubbing isn't frame-exact either.
Both problems disappear if the clip is decoded up front and the player becomes a flipbook.

Student animation clips are short. Decode them and the video path stops being special —
it's a `SequenceSource` with a decoder in front of it.

**The threshold is memory, not duration.** `frameCount × bytesPerFrame ≤ budget`:

| Resolution | Bytes/frame (RGB8) | Frames per GB | Seconds @ 24 fps per GB |
|---|---|---|---|
| 960×540 | 1.6 MB | 643 | 27 s |
| 1280×720 | 2.8 MB | 362 | 15 s |
| 1920×1080 | 6.2 MB | 161 | 6.7 s |
| 3840×2160 | 24.9 MB | 40 | 1.7 s |

**The budget comes from the browser, not the hardware.** This is the part that catches
people out. A review workstation with 128 GB of RAM and a 24 GB card does not hand a web
page anything like that: Chrome caps GPU memory per context and per GPU process, and
WebKit caps a tab's footprint independently of physical memory. Exceeding the GPU cap
doesn't crash — it fires `webglcontextlost`, which drops **every** texture and requires a
full rebuild. So context-loss handling is mandatory, not defensive polish, and the budget
is a measured constant per device class rather than a fraction of `deviceMemory`.

**Two-tier cache** — this is what actually exploits 128 GB:

- **L1, VRAM.** WebGL2 textures (`RGB8` via `texStorage2D`) for a window around the
  playhead — target ~240 frames, ~1.5 GB at 1080p. This is what the renderer samples.
- **L2, system RAM.** Raw `Uint8Array` frame buffers from `VideoFrame.copyTo()`, holding
  the whole clip and then some. Sized in *gigabytes* on the Macs. L1 misses are served by
  a texture upload from L2 — sub-millisecond on Apple Silicon's unified memory, and no
  decode.
- **L3, disk.** The all-intra proxy (§5.5). Any frame is one independent decode away, so
  even a cold miss is cheap.

Explicitly copying out to `Uint8Array` rather than keeping `ImageBitmap`s is deliberate:
ImageBitmaps may be GPU-backed depending on browser, which puts them right back under the
cap we're trying to escape. And `VideoFrame`s must be `close()`d immediately — WebCodecs
decoders have a small output pool and holding frames open stalls the decoder outright.
That's the single classic way this implementation fails.

**Starting budgets** — verify each on the actual device, then hard-code:

| Device | L1 (VRAM) | L2 (RAM) | 1080p24 fully cached |
|---|---|---|---|
| Review workstation (128 GB, 16–25 GB card) | 2 GB | 24 GB | ~4000 frames ≈ 2.7 min |
| MacBook Pro M4, 64 GB | 1.5 GB | 12 GB | ~2000 frames ≈ 80 s |
| MacBook Pro M1, 16 GB | 1 GB | 3 GB | ~480 frames ≈ 20 s |
| iPad Pro (16 GB device) | 500 MB | 2 GB | ~320 frames ≈ 13 s |

The iPad row is a *guess pending measurement* — its RAM is not the constraint, WebKit's
per-tab cap is, and that cap is undocumented and changes across iPadOS versions.

**Resolution policy follows the budget.** On the workstations and the 64 GB laptop, cache
at **native** resolution up to 1080p (4K for stills and short 4K clips) — which means
zooming to 400 % mid-playback needs no re-decode at all. Only the iPad and the 16 GB
laptop fall back to display-resolution caching with on-demand full-res decode when paused.

**Spend the headroom on the roster, not just the clip.** With a 24 GB L2 and typical 5–10 s
student clips, ten to twenty students' media stays resident at once. Prefetching the next
few students while reviewing the current one makes roster navigation instant — which, when
grading thirty submissions in a row, is worth more than any single playback feature here.

**Progressive, never blocking.** Frames stream into the cache from the playhead outward;
the viewer is interactive immediately and shows fill state on the timeline. If the clip
doesn't fit the budget, the same machinery runs as a sliding window (±N frames, decoded
both directions) — degraded, not broken. UI says which mode it's in.

Decode path: WebCodecs `VideoDecoder` + `mp4box`/`mediabunny` demux — Chrome, Safari 16.4+
(so the iPad is in), Firefox 130+. Hardware decode does 1080p at hundreds of fps, so a
120-frame clip caches in well under a second. Fallback for anything older: `<video>` +
`requestVideoFrameCallback` with seek-stepping, which the ingest trick below rescues.

### 5.5 The ingest trick that makes all of this cheap

**Encode the review proxy all-intra** — `-g 1`, every frame a keyframe:

```
ffmpeg -i in.mov -c:v libx264 -crf 18 -g 1 -preset fast -pix_fmt yuv420p \
       -vf "scale='min(1920,iw)':-2" -movflags +faststart out.mp4
```

Consequences, all good:
- **Random access is free.** Decoding frame 87 doesn't require walking a GOP from frame 60.
  Cache misses cost one frame's decode instead of thirty.
- **Reverse decode is free.** Bounce with a partial cache stops being a special case.
- **The `<video>` fallback becomes usable.** Seeks are frame-exact and fast when every
  frame is a keyframe, so seek-stepped reverse is tolerable on browsers without WebCodecs.
- **Frame ↔ time mapping is exact**, so annotation frame keys can't drift.

Cost is file size: ~20–40 Mbps vs ~8 Mbps, i.e. a 10 s clip is ~40 MB instead of ~10 MB.
On a studio LAN that's a fraction of a second, and the originals are kept regardless. Cap
the proxy at 1080p and it stays bounded. If a clip is long enough that this hurts, it's
also long enough to fall out of the full-cache path anyway — encode those normally.

`MediaSource` remains the seam: `VideoElementSource` and `DecodedVideoSource` are two
implementations of one interface, chosen at runtime by capability and budget.

### 5.6 Layered documents (PSD)

A `.psd` is one frame with a *layer stack*, and the stack is worth exposing: isolating the
sketch under the paint, checking whether the values were actually painted or filtered, and
seeing how the file is organised are all things an instructor grades. So `LayeredSource`
gets a layer panel — visibility toggles, solo, opacity and blend-mode readout — not just a
flattened image.

**Ingest is metadata-first, rasters-lazily.** `ag-psd` parses the file server-side and
writes a layer manifest (tree, names, bounds, opacity, blend mode, visibility, clipping,
group structure) plus the flattened composite. Individual layer rasters are *not* rendered
up front — a 4000×4000 PSD with 150 layers would be gigabytes of PNG for layers nobody
opens. Instead a route renders layer `n` on demand and caches the result, trimmed to the
layer's own bounds with an offset stored in the manifest (most layers cover a fraction of
the canvas). Groups render as flattened units until the user expands them.

Result: ingest stays fast and storage stays proportional to what's actually inspected.

**Compositing happens in the shader.** Layers are textures drawn back-to-front with their
blend mode; the WebGL renderer from §6 already does this. Separable modes — normal,
multiply, screen, overlay, darken, lighten, add, difference — are a few lines each.

Three honest limits, surfaced in the UI rather than papered over:
- **Non-separable modes** (hue, saturation, color, luminosity) need the full backdrop and
  are more work; render them correctly or fall back to normal *with a marker on the layer*.
- **Adjustment layers and smart filters cannot be re-applied** client-side. They're baked
  into the composite and marked non-toggleable.
- **Toggling layers means the view no longer matches the composite.** A "Composite / Layers"
  switch makes that explicit, and the composite is always one click away.

Guard rails: above a layer-count or total-pixel cap, the panel opens in composite-only mode
with the tree still browsable, and layers render individually on request.

Nice consequence for annotation: the visible-layer set is part of view state, so a note can
be pinned to *a layer configuration* — "here, with only the linework on". Cheap to store
(a list of layer ids on the stroke or on a saved bookmark) and genuinely useful in critique.

---

## 6. Renderer — WebGL2, one quad

The current player has two stacked canvases: a 2D display canvas with `setTransform`, and
a Fabric canvas with a matching `setViewportTransform`. Keep the two-layer idea; change the
bottom layer to WebGL2.

Reason: **every remaining requirement is a shader uniform.**

| Feature | Cost in WebGL |
|---|---|
| Flip H / flip V (requirement 13) | sign flip in the texture matrix — free, works mid-playback |
| Rotate 90/180/270 | same matrix |
| Zoom / pan | same matrix |
| ICC / primaries conversion (§9) | 3×3 matrix + TRC in the fragment shader |
| 3D LUT (.cube) | one `sampler3D` |
| Exposure / gamma / contrast | 3 uniforms |
| Channel isolate (R/G/B/A/luma) | one uniform |
| Desaturate ("value check"), squint-blur | trivial passes |
| Difference blend / A-B wipe | second texture |

Same code path for images, pdf pages, psd composites, and video — all become textures.
2D-canvas fallback path for the case where WebGL2 is unavailable (flip + zoom only).

The annotation overlay stays a plain 2D canvas on top, sharing the same view matrix.

---

## 7. Annotations

### 7.1 Coordinate space
Strokes are stored in **normalised media space** (0..1 of width/height), never in canvas or
screen pixels. Non-negotiable: the iPad, the presenter's laptop and the projector all have
different canvas sizes, and zoom/pan/flip change the mapping continuously. Media space is
the only space in which a stroke drawn on the iPad lands in the right place on the wall.

(Current code draws in Fabric viewport space, and `canvas-video-player.tsx` places shapes
with `getViewportPoint` while a viewport transform is active — rect/ellipse/arrow/text
land in the wrong place when zoomed or panned. Pen is unaffected. Worth knowing so the
behaviour isn't accidentally reproduced.)

### 7.2 Wire format — replace Fabric JSON
Fabric's `toJSON()` for a single freehand stroke is ~4–8 KB (every default property, full
`Q x y x y` path commands as decimal strings). For live streaming across a room that's the
wrong order of magnitude.

Binary record, stored as a SQLite BLOB, base64 only when it rides on a JSON channel:

```
u8    version
u8    tool          0 pen 1 line 2 arrow 3 rect 4 ellipse 5 text 6 highlight 7 stamp
u8    flags         bit0 pressure present, bit1 filled, bit2 constrained
u8    width         px × 2
u32   rgba
u16   pointCount
      pointCount × { zigzag-varint dx, zigzag-varint dy }   // 14-bit normalised units
      [pointCount × u8 pressure]                            // if flags bit0
```

A 200-point stroke: ~400 bytes vs ~6 KB. Roughly 15× smaller, and deltas stay in one byte
for normal drawing speeds. The codec is ~60 lines of pure TS and unit-testable.

### 7.3 Storage — append-only
```sql
CREATE TABLE review_strokes (
  id INTEGER PRIMARY KEY,
  item_id TEXT NOT NULL,          -- submission id (+ page, for multi-page)
  seq INTEGER NOT NULL,           -- monotonic per item; the sync cursor
  frame_in INTEGER NOT NULL,      -- 0 for stills
  frame_out INTEGER NOT NULL,     -- == frame_in; see 7.4
  author_id TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT                 -- soft delete = undo, and keeps sync monotonic
);
CREATE INDEX review_strokes_item_frame ON review_strokes(item_id, frame_in);
CREATE INDEX review_strokes_item_seq   ON review_strokes(item_id, seq);
```

Append-only buys four things at once:
- **Incremental sync.** `WHERE seq > ?` — a joining device pulls only what it missed.
- **No clobbering.** The current `saveAnnotations()` does `DELETE all` then re-INSERT for
  the whole submission. Two devices annotating the same submission means whoever saves
  last erases the other's work. Append-only removes the failure mode entirely.
- **Per-author** show/hide, colour-coding, and undo scoped to your own strokes.
- **Timeline markers** come from one cheap query, no stroke decoding:
  `SELECT DISTINCT frame_in FROM review_strokes WHERE item_id=? AND deleted_at IS NULL`.

Migration: existing Fabric JSON rows convert to strokes on first open (paths → polylines,
shapes → their primitives), original rows retained until it's proven.

### 7.4 Frame hold — tried it, removed it
Requirement 10 says annotations must be visible *during playback*, and a stroke pinned to
one frame at 24 fps is on screen for 42 ms. The first answer was a hold range: every stroke
carried `frame_in`/`frame_out` with a settable default of ~0.75 s, and the timeline drew a
bar across it.

In use that was wrong. A note is about *a frame* — this pose, this silhouette, this
in-between — and smearing it across the next 24 makes it look like a note about a shot.
Notes from adjacent frames overlap and turn into a mess. **A note now shows on the frame it
was drawn on and nowhere else.**

Which puts the whole weight of requirement 10 on navigation rather than on dwell time: the
**"stop on annotated frames"** toggle, and `[` / `]` to jump to the previous/next annotated
frame (requirement 10's "cycle"). That is how notes get read back.

`frame_out` stays in the table and in the codec — it costs one varint and re-widening a
note later is a schema-free change — but it is written equal to `frame_in`, and the
renderer does not consult it. Strokes saved before this still carry their old ranges; they
display on `frame_in` like everything else.

### 7.5 Tools
Pen, highlighter (multiply blend), line, arrow, rect, ellipse, text, eraser (stroke-level,
not pixel — stays vector and stays cheap), stamps. 8–10 colours, 4 widths, opacity.
Apple Pencil pressure and tilt via `PointerEvent.pressure` — the iPad is a stated device,
so this is cheap and disproportionately nice.

Input is split by `pointerType` rather than by heuristic: a stylus draws and never navigates,
a touch navigates and never draws, and a mouse does both because a desktop has no stylus to
take over. Palm rejection then needs no code — a palm is a touch. Trying to be clever about
it instead (ignore the second contact, cancel on two pointers) is what dropped whole letters
out of the middle of a word.

Input smoothing (one-euro filter) before RDP simplification: RDP alone reduces point count
but doesn't fix shaky touch input.

---

## 8. Remote control / master mode

### 8.1 Roles
A **session** is scoped to a context (assignment). Each connected device is
`master` | `follower` | `free`.
- `master` — its actions are broadcast. Exactly one at a time.
- `follower` — applies incoming actions; local transport controls are disabled (or
  "break away", which drops it to `free` with a Rejoin button).
- `free` — browsing on its own, ignores transport events, **still sends annotations**.

Authorship is independent of control: a follower drawing on the projector host is a
first-class stroke author (requirement 8). Master is about *transport*, not *drawing*.

Claiming is last-writer-wins with the holder stored in the DB so it survives a reload, plus
a "Request control" ping. Presence list shows every device, name, role and round-trip latency.

### 8.2 One action set, one reducer
State is a serialisable struct; every mutation is a small closed action. Remote control is
then literally "broadcast the actions I dispatch; apply the actions I receive" — no separate
sync code path, no divergence between what a local click does and what a remote one does.

```ts
type Action =
  | { a:'goto';   item:number; frame:number }        // media switch (req. 6)
  | { a:'seek';   frame:number }
  | { a:'transport'; playing:boolean; frame:number; rate:number; at:number }
  | { a:'loop';   mode:'off'|'loop'|'bounce' }
  | { a:'fps';    fps:number }
  | { a:'flip';   h:boolean; v:boolean }
  | { a:'rotate'; deg:0|90|180|270 }
  | { a:'view';   zoom:number; panX:number; panY:number }   // opt-in "follow view"
  | { a:'color';  transform:string; exposure:number; gamma:number }
  | { a:'stroke'; s:StrokeRecord }                          // committed
  | { a:'ink';    id:string; pts:number[] }                 // live, in-progress
  | { a:'erase';  ids:number[] }
  | { a:'laser';  x:number; y:number }                      // ephemeral, never stored
  | { a:'claim'|'release'; client:string; name:string }
```

Per-field sync policy, in three tiers:

- **Transport** — always. Play, pause, seek, item, rate, loop, fps.
- **Presentation** — always. Flip, rotate, Value/saturation, channel, guides, PSD layer
  visibility. These change *what the image is*, and a room that disagrees about them is
  talking past itself: "look at the shoulder line" means nothing if half the room is
  looking at an unflipped copy. Originally these sat with view, behind the toggle, which
  made the common case — flip to check a drawing — silently private.
- **View** — zoom and pan only: *where* you are looking rather than what at. The master
  always sends it; each receiving screen decides whether to apply it, via "Follow view"
  (default on). That gating belongs to the receiver and only the receiver — reading the
  sender's copy of the flag meant zoom crossed only when both machines happened to have
  the box ticked, so ticking it on the follower, the one place it means anything, did
  nothing at all.

Deltas alone are not enough. Every action above is a delta, so one dropped message leaves a
follower wrong until that same field changes again — which for a flip might be never. The
master therefore also sends a `sync` snapshot of its whole visible state: on a 5 s
heartbeat, and to anyone who says `hello`. A screen says hello when it returns to the
foreground, which makes recovery event-driven rather than timer-driven — browsers throttle
timers in hidden tabs to roughly once a minute, and the hello path keeps working there.
That ordering is right on its own terms: a screen nobody is looking at cannot be visibly
stale, so the moment to reconcile is the moment someone looks. The snapshot returns the
identical state object when nothing changed, so an idle heartbeat costs no render.

Tools and colours never travel — that is your pen, not the room's.

One trap worth naming: the channel envelope stamps `sender`, `ctx` and `kind` over the
action, so an action field named any of those is destroyed in flight. The guides action
first shipped with its payload in `kind` and every follower received the literal string
"art-review" where a guide name should have been.

### 8.3 Don't stream frame numbers
Broadcasting the playhead every frame produces jitter and floods the channel. Instead the
master sends one `transport` action on state change, carrying `{ playing, frame, rate, at }`
where `at` is a shared-epoch timestamp. Followers run their own rAF loop:

```
elapsed = (now + clockOffset - at) / 1000
frame   = fold(frame0 + elapsed * fps * rate, n, mode)
```

`clockOffset` from a ping/pong exchange on connect and every ~30 s. Drift correction: if the
follower is more than ~2 frames off the computed target, hard-seek; otherwise let it ride.
Result: every screen in the room stays locked without per-frame traffic.

Live ink (`a:'ink'`) is the exception that does stream — point batches at ~50 ms while the
stroke is in progress, so the room watches the line being drawn, then one `stroke` commit
to the DB. Batches are not persisted; a dropped batch is corrected by the commit.

### 8.4 Transport layer
Reuse what's already working: SSE (`GET /api/sync`) + `POST` fan-out. Behind a `ReviewChannel`
interface so a WebSocket (or WebRTC data channel, with SSE as signalling) is a drop-in later
if LAN latency proves annoying.

Three practical notes on the existing setup:
- **Ride the existing stream; do not add another.** Grader already opens `/api/sync` and
  `/api/sync/[assignmentId]` per tab. Browsers cap ~6 concurrent HTTP/1.1 connections per
  origin, and `next dev`/`next start` are HTTP/1.1.
  *This was not hypothetical.* The review channel was first built as a third dedicated
  SSE stream, and two tabs on one machine then held all six connections open. Every other
  request — including the server action that loads the media — stalled forever with no
  error, showing only "Preparing media…". `ReviewChannel` is now implemented on top of
  grader's global sync bus and adds no connection at all, keeping a tab at two streams.
  The cost: review traffic fans out to every connected tab and is discarded client-side
  by `ctx`. If live-ink volume ever makes that hurt, the answer is a WebSocket — not
  another SSE stream.
- **The listener registry is in-process.** Both routes keep a module-level `Set`. Correct for
  one `next start` process on the studio PC; silently broken across multiple workers or any
  serverless deploy. Fine — but it should be a stated constraint, not an accident.
- **Reconnect with a cursor.** SSE reconnects should resume from `lastSeq` so a device that
  drops for 10 s doesn't miss strokes. Queue local strokes in IndexedDB while offline.

---

## 9. Color management — what's actually achievable

Realistic goal: **the same file looks the same on the studio display, the iPad and the
projector, and wide-gamut source files aren't silently clamped to sRGB.** Full ICC v4 with
perceptual rendering intents is not on the table in a browser.

**Ingest.** `sharp` extracts the embedded ICC profile. Matrix/TRC profiles (sRGB, AdobeRGB,
Display P3, ProPhoto — i.e. nearly all RGB working spaces) reduce to a 3×3 + transfer
function and can be applied exactly in the shader; store the primaries in `review_media`.
LUT-based profiles (CMYK, printer profiles) get converted at ingest via lcms (`sharp`) to a
tagged Display-P3 derivative, because they can't go in a shader.

**Decode.** `createImageBitmap(blob, { colorSpaceConversion: 'none' })` so the browser
doesn't quietly convert first — then we do the conversion explicitly. That's the difference
between colour management and hoping.

**Display.** `canvas.getContext('webgl2')` with `drawingBufferColorSpace = 'display-p3'`
where supported (Chrome, Safari), sRGB otherwise; the OS applies the monitor profile.

**View transforms** in the UI: `Native` / `sRGB` / `Display P3` / `Rec.709`, plus exposure
and gamma, plus optional `.cube` 3D LUT upload (per assignment) for anyone reviewing
film-pipeline work.

**Video is the weak spot.** `<video>` hands you browser-managed colour with no hook. Under
WebCodecs (v2), `VideoFrame.colorSpace` exposes primaries/transfer/matrix and we can convert
properly. Until then: correct for Rec.709/sRGB content, best-effort for anything else. HDR
gets tone-mapped by the browser and there is no reliable way around that. Say so up front
rather than implying otherwise.

Adjacent and nearly free once the shader exists: histogram, RGB parade, vectorscope, and a
clipping/false-colour overlay.

---

## 10. Build order

| Phase | Contents | Why here |
|---|---|---|
| **0** | Range requests; ingest pipeline (ffprobe/ffmpeg/sharp/pdf/psd); all-intra proxies; `review_media` | Everything else assumes media that actually plays, known fps, and cheap random access |
| **1** | `MediaSource` + Still/Page/Sequence; **WebCodecs frame cache + VRAM texture pool**; WebGL2 renderer; playlist; timeline + scrub; loop/bounce; fps; flip/rotate; keymap | Requirements 1,2,3,5,11,12,13 — and bounce/scrub are only honest with the frame cache |
| **2** | Stroke codec; append-only tables; markers; prev/next annotated; undo/redo; colours/widths; pressure | Requirements 7,8,9,10 |
| **3** | Session + roles; one action set; clock-synced transport; live ink; laser; presence | Requirement 6 |
| **4** | ICC ingest; view transforms; LUTs; scopes | Requirement 4 |
| **5** | Compare/wipe; onion skin; export to PDF/MP4; session recording; tiled pyramid for huge stills | Upgrades that need the rest to exist first |

Phases 1–3 are the replacement. 4–5 are what make it better than what it replaces.
`VideoElementSource` (`<video>` + rVFC) is still built in phase 1, but as the capability
fallback rather than the primary path.

---

## 11. Dependencies

Add: `pdfjs-dist` (pdf pages), `ag-psd` (psd/psb parse + layer rasters, server-side — §5.6),
`sharp` (promote from transitive to explicit; ICC + layer raster encoding),
`mp4box` or `mediabunny` (WebCodecs demux — now phase 1).
Drop: `fabric` (once the old review page is retired).
System: `ffmpeg`/`ffprobe` — present at `/opt/homebrew/bin`.

---

## 12. Scope decisions

**Settled**

1. **Frame engine** — decode-to-frame-cache is phase 1 (§5.4), not a later upgrade.
2. **PSD** — per-layer, metadata-first with lazy rasters and shader compositing (§5.6).
3. **Deployment** — LAN only (§12.1).
4. **Reviewers** — instructor only (§12.2).

**Still open**

5. **Measured memory budgets** (§5.4). Hardware is generous — 128 GB review workstations
   with 16–25 GB cards, 16–64 GB MacBook Pros, a 16 GB iPad Pro — but the real limits are
   Chrome's per-context GPU cap and WebKit's per-tab cap, neither of which tracks physical
   memory and neither of which is documented. The table in §5.4 is a starting point to be
   replaced with numbers from a real clip on each device class. Cheapest way to get them:
   a throwaway page that allocates textures and frame buffers in a loop until
   `webglcontextlost` fires or the tab dies, run once per device.

### 12.1 LAN-only — the constraint, and the seam out of it

Assumed: one `next start` process on the studio machine, every device on the same network,
no auth, no hostile clients.

That assumption is load-bearing in four places, so they're worth naming:
- **The SSE listener registry is a module-level `Set`** — correct for one process, silently
  broken across workers or any serverless deploy.
- **No auth on `/api/sync` or the media routes.** Anyone on the network can watch a review
  and post transport actions.
- **All-intra proxies are ~4× the bitrate** (§5.5). Free on gigabit ethernet, painful over
  a home uplink.
- **Clock sync assumes sub-10 ms RTT.** The drift correction thresholds in §8.3 are tuned
  for that.

Going internet-reachable later means, roughly in order: auth on the SSE and media routes
(signed URLs or session cookies) → pub/sub outside the process (Redis, or a small WS server)
so fan-out survives multiple workers → normal-GOP proxies with an adaptive ladder, keeping
all-intra only for LAN → looser clock-sync thresholds, and probably WebSocket or a WebRTC
data channel instead of SSE+POST for the live-ink path. None of it forces a redesign,
because the `ReviewChannel` interface (§8.4) and the `ReviewDataAdapter` (§3) are already
the only two places that touch the network. Keeping them the only two is the discipline.

### 12.2 Instructor-only — with peer critique left possible

Only instructors open the reviewer; every stroke has one author. That removes visibility
rules, per-author layer toggles, moderation, and student identity plumbing from the build.

One thing carries forward anyway: **`author_id` stays on every stroke from day one**, and
strokes stay append-only with soft deletes (§7.3). Both cost nothing now and are exactly
what a second author would otherwise require a migration to add. Undo is already scoped by
author internally even though there's only ever one.

**Peer critique, if it happens later.** Worth flagging because it's a more interesting
change than it looks — the schema is nearly ready but the *pedagogy* is where the design
work is:
- Students annotating each other's work turns the stroke colour legend into an attribution
  system; per-author show/hide becomes essential rather than cosmetic.
- Blind-until-submitted review (you can't see other students' notes until you've made your
  own) is a real classroom pattern and needs a visibility state machine on top of the
  append-only log — which the log supports well, since nothing is ever destructively edited.
- Live sessions get a raise-hand / pass-the-pen model: the master role (§8.1) already
  separates transport control from authorship, so handing a student the pen during a group
  crit is a role grant, not new machinery.
- Grading the *critique* — a student's annotations on a peer's work as an assessable
  artifact — falls straight out of `author_id` plus the session recording in phase 5.
- What genuinely needs building: identity beyond "instructor", visibility rules, and some
  form of moderation or retraction. Non-trivial, but nothing above conflicts with the
  current design.
