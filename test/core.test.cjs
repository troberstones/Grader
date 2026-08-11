/**
 * Unit tests for the pure core. Run with `npm test` (compiles src/core to CJS
 * in a temp dir first — see scripts/build-test.sh).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const OUT = process.env.CORE_OUT || path.join(__dirname, ".build");
const { fold, step, prevMarker, nextMarker } = require(path.join(OUT, "fold.js"));
const {
  encodeStroke,
  decodeStroke,
  simplify,
  hexToRgba,
  rgbaToHex,
  toBase64,
  fromBase64,
} = require(path.join(OUT, "strokes.js"));
const { reduceViewer, initialStateFor } = require(path.join(OUT, "reducer.js"));
const { DEFAULT_VIEWER_STATE } = require(path.join(OUT, "types.js"));
const { ClockSync, projectFrame, needsResync } = require(path.join(OUT, "clock.js"));
const { chooseCacheSize, BUDGETS, framesThatFit } = require(path.join(OUT, "budget.js"));
const { isBroadcast, shouldApply } = require(path.join(OUT, "actions.js"));

// ── fold: loop and bounce ─────────────────────────────────────────────────────

test("fold: off clamps at both ends", () => {
  assert.equal(fold(-5, 10, "off"), 0);
  assert.equal(fold(0, 10, "off"), 0);
  assert.equal(fold(9, 10, "off"), 9);
  assert.equal(fold(50, 10, "off"), 9);
});

test("fold: loop wraps in both directions", () => {
  assert.equal(fold(0, 10, "loop"), 0);
  assert.equal(fold(10, 10, "loop"), 0);
  assert.equal(fold(13, 10, "loop"), 3);
  assert.equal(fold(-1, 10, "loop"), 9);
  assert.equal(fold(-11, 10, "loop"), 9);
});

test("fold: bounce ping-pongs without repeating the endpoints", () => {
  const n = 5; // period 8: 0 1 2 3 4 3 2 1 | 0 1 2 …
  const seen = [];
  for (let k = 0; k < 16; k++) seen.push(fold(k, n, "bounce"));
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1]);
});

test("fold: bounce handles negatives and degenerate clips", () => {
  assert.equal(fold(-1, 5, "bounce"), 1);
  assert.equal(fold(-3, 5, "bounce"), 3);
  assert.equal(fold(7, 1, "bounce"), 0);
  assert.equal(fold(7, 0, "loop"), 0);
});

test("fold: never returns out-of-range for any mode", () => {
  for (const mode of ["off", "loop", "bounce"]) {
    for (let n = 1; n < 9; n++) {
      for (let k = -30; k < 30; k++) {
        const f = fold(k, n, mode);
        assert.ok(f >= 0 && f <= n - 1, `${mode} n=${n} k=${k} -> ${f}`);
        assert.equal(f, Math.floor(f));
      }
    }
  }
});

test("step: turns around at the ends under bounce", () => {
  assert.equal(step(4, 1, 5, "bounce"), 3);
  assert.equal(step(0, -1, 5, "bounce"), 1);
  assert.equal(step(2, 1, 5, "bounce"), 3);
  assert.equal(step(9, 1, 10, "loop"), 0);
  assert.equal(step(9, 1, 10, "off"), 9);
});

test("markers: prev/next annotated frame", () => {
  const frames = [3, 10, 42];
  assert.equal(nextMarker(frames, 0), 3);
  assert.equal(nextMarker(frames, 10), 42);
  assert.equal(nextMarker(frames, 42), null);
  assert.equal(prevMarker(frames, 42), 10);
  assert.equal(prevMarker(frames, 3), null);
});

// ── stroke codec ──────────────────────────────────────────────────────────────

function makeStroke(overrides = {}) {
  return {
    localId: "abc",
    tool: "pen",
    color: 0xff0000ff,
    width: 4,
    frameIn: 12,
    frameOut: 30,
    authorId: "u1",
    points: [0.1, 0.2, 0.3, 0.4],
    ...overrides,
  };
}

const META = { frameIn: 12, frameOut: 30, authorId: "u1" };

test("codec: round-trips geometry within quantisation error", () => {
  const points = [];
  for (let i = 0; i < 200; i++) points.push(i / 400, 0.5 + Math.sin(i / 9) * 0.2);
  const s = makeStroke({ points });
  const decoded = decodeStroke(encodeStroke(s), META);

  assert.equal(decoded.points.length, points.length);
  for (let i = 0; i < points.length; i++) {
    assert.ok(
      Math.abs(decoded.points[i] - points[i]) < 1 / 16383,
      `point ${i}: ${decoded.points[i]} vs ${points[i]}`,
    );
  }
  assert.equal(decoded.tool, "pen");
  assert.equal(decoded.color, 0xff0000ff);
  assert.equal(decoded.width, 4);
  assert.equal(decoded.frameIn, 12);
  assert.equal(decoded.frameOut, 30);
});

test("codec: a 200-point stroke stays far below Fabric's JSON size", () => {
  const points = [];
  for (let i = 0; i < 200; i++) points.push(i / 400, 0.5 + Math.sin(i / 9) * 0.2);
  const bytes = encodeStroke(makeStroke({ points }));
  // Fabric emits 4-8 KB for the equivalent path. Hold the line at 1 KB.
  assert.ok(bytes.length < 1024, `expected < 1024 bytes, got ${bytes.length}`);
  assert.ok(bytes.length > 100, `suspiciously small: ${bytes.length}`);
});

test("codec: preserves pressure, text, fill and layer pins", () => {
  const s = makeStroke({
    tool: "text",
    text: "check the silhouette — é ✓",
    filled: true,
    layers: ["layer-3", "layer-7"],
    pressure: [0.1, 0.9],
    points: [0.25, 0.25, 0.75, 0.75],
  });
  const d = decodeStroke(encodeStroke(s), META);
  assert.equal(d.tool, "text");
  assert.equal(d.text, "check the silhouette — é ✓");
  assert.equal(d.filled, true);
  assert.deepEqual(d.layers, ["layer-3", "layer-7"]);
  assert.equal(d.pressure.length, 2);
  assert.ok(Math.abs(d.pressure[0] - 0.1) < 0.01);
  assert.ok(Math.abs(d.pressure[1] - 0.9) < 0.01);
});

test("codec: clamps out-of-range coordinates instead of corrupting the stream", () => {
  const d = decodeStroke(encodeStroke(makeStroke({ points: [-1, 2, 0.5, 0.5] })), META);
  assert.equal(d.points[0], 0);
  assert.equal(d.points[1], 1);
  assert.ok(Math.abs(d.points[2] - 0.5) < 0.001);
});

test("codec: empty stroke round-trips", () => {
  const d = decodeStroke(encodeStroke(makeStroke({ points: [] })), META);
  assert.equal(d.points.length, 0);
});

test("codec: rejects a bad version byte rather than returning garbage", () => {
  const bytes = encodeStroke(makeStroke());
  bytes[0] = 99;
  assert.throws(() => decodeStroke(bytes, META), /version/);
});

test("codec: rejects truncated input", () => {
  const bytes = encodeStroke(makeStroke());
  assert.throws(() => decodeStroke(bytes.slice(0, 6), META), /truncated|version/);
});

test("codec: base64 survives the JSON channel", () => {
  const bytes = encodeStroke(makeStroke());
  const back = fromBase64(toBase64(bytes));
  assert.deepEqual(Array.from(back), Array.from(bytes));
});

test("colour helpers round-trip", () => {
  assert.equal(hexToRgba("#ef4444"), 0xef4444ff);
  assert.equal(rgbaToHex(0xef4444ff), "#ef4444");
  assert.equal(hexToRgba("#00000000"), 0x00000000);
});

test("simplify: drops collinear points, keeps the endpoints", () => {
  const line = [0, 0, 0.1, 0, 0.2, 0, 0.3, 0, 0.4, 0, 0.5, 0];
  const out = simplify(line, 0.001);
  assert.deepEqual(out, [0, 0, 0.5, 0]);
});

test("simplify: keeps a genuine corner", () => {
  const bend = [0, 0, 0.25, 0, 0.5, 0.5];
  const out = simplify(bend, 0.01);
  assert.equal(out.length / 2, 3);
});

test("simplify: handles a long stroke without blowing the stack", () => {
  const pts = [];
  for (let i = 0; i < 60000; i++) pts.push(i / 60000, Math.sin(i / 50) * 0.4 + 0.5);
  const out = simplify(pts, 0.0005);
  assert.ok(out.length > 0 && out.length < pts.length);
});

// ── reducer ───────────────────────────────────────────────────────────────────

const ITEMS = [
  { id: "a", label: "a", kind: "video", mime: "video/mp4", url: "", width: 1920, height: 1080, frameCount: 100, fps: 24, duration: 4.16 },
  { id: "b", label: "b", kind: "still", mime: "image/png", url: "", width: 800, height: 600, frameCount: 1, fps: null, duration: null },
];
const CTX = { items: ITEMS };

test("reducer: seek folds through the active loop mode", () => {
  const s = { ...DEFAULT_VIEWER_STATE, loop: "loop" };
  assert.equal(reduceViewer(s, { a: "seek", frame: 105 }, CTX).frame, 5);
  const off = { ...DEFAULT_VIEWER_STATE, loop: "off" };
  assert.equal(reduceViewer(off, { a: "seek", frame: 105 }, CTX).frame, 99);
});

test("reducer: goto clamps the frame to the new item", () => {
  const s = { ...DEFAULT_VIEWER_STATE, frame: 90 };
  const next = reduceViewer(s, { a: "goto", item: 1, frame: 90 }, CTX);
  assert.equal(next.itemIndex, 1);
  assert.equal(next.frame, 0);
});

test("reducer: switching item resets framing but keeps review preferences", () => {
  const s = {
    ...DEFAULT_VIEWER_STATE,
    zoom: 3,
    panX: 40,
    flipH: true,
    loop: "bounce",
    color: { ...DEFAULT_VIEWER_STATE.color, saturation: 0 },
  };
  const next = reduceViewer(s, { a: "goto", item: 1, frame: 0 }, CTX);
  assert.equal(next.zoom, 1, "zoom resets");
  assert.equal(next.panX, 0, "pan resets");
  assert.equal(next.flipH, true, "flip persists across the roster");
  assert.equal(next.loop, "bounce", "loop mode persists");
  assert.equal(next.color.saturation, 0, "colour settings persist");
});

test("reducer: goto adopts the new item's authored fps", () => {
  const s = { ...DEFAULT_VIEWER_STATE, itemIndex: 1, fps: 60 };
  assert.equal(reduceViewer(s, { a: "goto", item: 0, frame: 0 }, CTX).fps, 24);
});

test("reducer: toggling a layer leaves composite mode", () => {
  const s = { ...DEFAULT_VIEWER_STATE, composite: true };
  const next = reduceViewer(s, { a: "layers", visible: { l1: false } }, CTX);
  assert.equal(next.composite, false);
  assert.equal(next.layers.l1, false);
});

test("reducer: zoom is clamped", () => {
  const s = DEFAULT_VIEWER_STATE;
  assert.equal(reduceViewer(s, { a: "view", zoom: 1000 }, CTX).zoom, 32);
  assert.equal(reduceViewer(s, { a: "view", zoom: 0 }, CTX).zoom, 0.05);
});

test("reducer: unknown actions leave state identical", () => {
  const s = DEFAULT_VIEWER_STATE;
  assert.equal(reduceViewer(s, { a: "laser", x: 0, y: 0, client: "x" }, CTX), s);
});

test("initialStateFor clamps into range", () => {
  const s = initialStateFor(ITEMS, { itemIndex: 9, frame: 500 }, DEFAULT_VIEWER_STATE);
  assert.equal(s.itemIndex, 1);
  assert.equal(s.frame, 0);
});

// ── clock ─────────────────────────────────────────────────────────────────────

test("clock: recovers a known offset from ping/pong", () => {
  const c = new ClockSync();
  // Remote runs 5000 ms ahead; 40 ms symmetric RTT.
  c.sample(1000, 1020 + 5000, 1040);
  assert.ok(Math.abs(c.offset - 5000) < 1, `offset ${c.offset}`);
  assert.equal(c.rtt, 40);
});

test("clock: prefers the lowest-RTT sample over a noisy one", () => {
  const c = new ClockSync();
  c.sample(0, 900, 1000); // 1000 ms RTT, badly skewed
  c.sample(2000, 2010 + 100, 2020); // 20 ms RTT, offset 100
  assert.ok(Math.abs(c.offset - 100) < 2, `offset ${c.offset}`);
  assert.equal(c.rtt, 20);
});

test("clock: ignores implausible samples", () => {
  const c = new ClockSync();
  c.sample(1000, 500, 500); // negative RTT
  assert.equal(c.rtt, null);
});

test("clock: reports whether it has actually been measured", () => {
  // Before this existed, an unsynced clock silently reported offset 0, i.e.
  // "both machines agree on the wall clock" — they do not, and a follower
  // extrapolating across that skew lands tens of frames away.
  const c = new ClockSync();
  assert.equal(c.synced, false);
  c.sample(1000, 1020, 1040);
  assert.equal(c.synced, true);
  c.reset();
  assert.equal(c.synced, false);
});

test("clock: an unsynced follower must not extrapolate a remote timestamp", () => {
  const c = new ClockSync();
  // Master's clock is 4 s ahead and we have no sample yet.
  const masterAt = Date.now() + 4000;
  const snap = { playing: true, frame: 10, rate: 1, at: masterAt };

  const naive = projectFrame(snap, c.sharedNow(), 25, 500, "loop");
  // Extrapolating across 4 s of skew is 100 frames of error at 25 fps.
  assert.ok(Math.abs(naive - 10) > 50, `expected large drift, got ${naive}`);

  // Anchoring to our own clock instead keeps it on the intended frame.
  const anchored = projectFrame({ ...snap, at: c.sharedNow() }, c.sharedNow(), 25, 500, "loop");
  assert.equal(anchored, 10);
});

test("projectFrame: a follower lands where the master is", () => {
  const snap = { playing: true, frame: 0, rate: 1, at: 10_000 };
  // 1 second later at 24 fps → frame 24
  assert.equal(projectFrame(snap, 11_000, 24, 100, "loop"), 24);
  // 5 seconds at 24 fps over a 100-frame loop → 120 → 20
  assert.equal(projectFrame(snap, 15_000, 24, 100, "loop"), 20);
  // paused ignores elapsed time entirely
  assert.equal(projectFrame({ ...snap, playing: false, frame: 7 }, 99_999, 24, 100, "loop"), 7);
});

test("projectFrame: honours rate and bounce", () => {
  const snap = { playing: true, frame: 0, rate: 2, at: 0 };
  assert.equal(projectFrame(snap, 1000, 24, 100, "loop"), 48);
  const bounce = { playing: true, frame: 0, rate: 1, at: 0 };
  // 5 frames into a 5-frame bounce clip = back to frame 3
  assert.equal(projectFrame(bounce, (5 / 24) * 1000, 24, 5, "bounce"), 3);
});

test("needsResync: tolerates sub-2-frame drift and loop wrap", () => {
  assert.equal(needsResync(10, 11, 100, "loop"), false);
  assert.equal(needsResync(10, 20, 100, "loop"), true);
  assert.equal(needsResync(99, 0, 100, "loop"), false, "wrap is not drift");
});

// ── budget ────────────────────────────────────────────────────────────────────

test("budget: a whole-clip cache never exceeds the budget it claims to fit in", () => {
  // The invariant that matters. This is what was wrong before: budgets were
  // sized against physical RAM, so 'fits' meant 2 GB of ArrayBuffers in a tab.
  for (const tier of Object.keys(BUDGETS)) {
    const budget = BUDGETS[tier];
    for (const [w, h, n] of [
      [1920, 1080, 240],
      [1920, 1080, 60],
      [3840, 2160, 300],
      [1280, 720, 500],
    ]) {
      const r = chooseCacheSize(budget, w, h, n, 1600);
      if (r.fitsWholeClip) {
        const bytes = r.width * r.height * 4 * n;
        assert.ok(
          bytes <= budget.ram,
          `${tier} ${w}x${h}×${n}: claims to fit but needs ${(bytes / 1e6).toFixed(0)} MB of ${(budget.ram / 1e6).toFixed(0)} MB`,
        );
      }
      assert.ok(r.width <= budget.maxCacheWidth, `${tier}: exceeded maxCacheWidth`);
      assert.ok(r.width >= 320 && r.height >= 180, `${tier}: degenerate cache size`);
    }
  }
});

test("budget: a short clip still caches at native resolution", () => {
  // 60 frames of 1080p is ~500 MB — comfortably inside the workstation tier.
  const r = chooseCacheSize(BUDGETS.workstation, 1920, 1080, 60, 1600);
  assert.equal(r.fitsWholeClip, true);
  assert.equal(r.width, 1920);
});

test("budget: no tier allows more than the absolute tab ceiling", () => {
  const { ABSOLUTE_RAM_CEILING } = require(path.join(OUT, "budget.js"));
  for (const tier of Object.keys(BUDGETS)) {
    assert.ok(
      BUDGETS[tier].ram <= ABSOLUTE_RAM_CEILING,
      `${tier} budget exceeds the tab ceiling`,
    );
  }
});

test("budget: the iPad steps down rather than failing", () => {
  const r = chooseCacheSize(BUDGETS.tablet, 3840, 2160, 600, 1024);
  assert.ok(r.width <= 1280, `width ${r.width}`);
  assert.ok(r.width >= 320);
});

test("budget: an impossible clip reports it instead of pretending", () => {
  const r = chooseCacheSize(BUDGETS.conservative, 3840, 2160, 20000, 1024);
  assert.equal(r.fitsWholeClip, false);
});

test("budget: frames-per-gigabyte reflects RGBA storage", () => {
  // 1080p RGBA = 8.29 MB → ~129 frames per GiB
  const n = framesThatFit(1024 * 1024 * 1024, 1920, 1080);
  assert.ok(n >= 120 && n <= 135, `got ${n}`);
});

// ── broadcast policy ──────────────────────────────────────────────────────────

test("policy: only a master broadcasts transport", () => {
  assert.equal(isBroadcast("seek", { isMaster: true, followView: false }), true);
  assert.equal(isBroadcast("seek", { isMaster: false, followView: false }), false);
});

test("policy: view actions ride only when follow-view is on", () => {
  assert.equal(isBroadcast("view", { isMaster: true, followView: false }), false);
  assert.equal(isBroadcast("view", { isMaster: true, followView: true }), true);
});

test("policy: annotation and presence always travel, whatever the role", () => {
  for (const kind of ["stroke", "ink", "laser", "hello", "ping"]) {
    assert.equal(isBroadcast(kind, { isMaster: false, followView: false }), true, kind);
    assert.equal(shouldApply(kind, { role: "free", followView: false }), true, kind);
  }
});

test("policy: a free peer ignores remote transport", () => {
  assert.equal(shouldApply("seek", { role: "follower", followView: false }), true);
  assert.equal(shouldApply("seek", { role: "free", followView: false }), false);
  assert.equal(shouldApply("seek", { role: "master", followView: false }), false);
});
