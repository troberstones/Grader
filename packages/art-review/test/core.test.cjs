/**
 * Unit tests for the pure core. Run with `npm test` (compiles src/core to CJS
 * in a temp dir first — see scripts/build-test.sh).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const OUT = process.env.CORE_OUT || path.join(__dirname, ".build", "core");
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


const SNAPSHOT = {
  itemIndex: 0,
  flipH: true,
  flipV: false,
  rotate: 90,
  color: { transform: "srgb", exposure: 0, saturation: 0, blur: 0, channel: "b", lut: null },
  guides: "grid",
  layers: {},
  soloLayer: null,
  composite: true,
  zoom: 3,
  panX: 40,
  panY: -20,
  fit: "actual",
};

test("sync: a snapshot recovers a follower that missed the deltas", () => {
  const out = reduceViewer(DEFAULT_VIEWER_STATE, { a: "sync", s: SNAPSHOT }, { items: [] });
  assert.equal(out.flipH, true);
  assert.equal(out.rotate, 90);
  assert.equal(out.guides, "grid");
  assert.equal(out.color.channel, "b");
  assert.equal(out.color.saturation, 0);
});

test("sync: framing rides only for a follower with follow-view on", () => {
  const off = reduceViewer(DEFAULT_VIEWER_STATE, { a: "sync", s: SNAPSHOT }, { items: [] });
  assert.equal(off.zoom, DEFAULT_VIEWER_STATE.zoom, "zoom held");
  assert.equal(off.panX, DEFAULT_VIEWER_STATE.panX, "pan held");
  assert.equal(off.flipH, true, "but appearance still applied");

  const on = reduceViewer(
    DEFAULT_VIEWER_STATE,
    { a: "sync", s: SNAPSHOT },
    { items: [], followView: true },
  );
  assert.equal(on.zoom, 3);
  assert.equal(on.panX, 40);
  assert.equal(on.fit, "actual");
});

test("sync: an unchanged heartbeat is not a state change", () => {
  // Five seconds apart, forever. If each beat produced a new object every peer
  // would re-render and repaint on every one of them.
  const settled = reduceViewer(
    DEFAULT_VIEWER_STATE,
    { a: "sync", s: SNAPSHOT },
    { items: [], followView: true },
  );
  const again = reduceViewer(settled, { a: "sync", s: SNAPSHOT }, { items: [], followView: true });
  assert.equal(again, settled, "same object identity");
});

test("policy: only a master broadcasts transport", () => {
  assert.equal(isBroadcast("seek", { isMaster: true }), true);
  assert.equal(isBroadcast("seek", { isMaster: false }), false);
});

test("policy: follow-view is the receiver's call, not the sender's", () => {
  // The master always sends its framing. Reading its own follow-view here meant
  // zoom crossed only when both machines had the box ticked, so ticking it on
  // the follower — the only side it means anything on — did nothing.
  assert.equal(isBroadcast("view", { isMaster: true }), true);
  assert.equal(isBroadcast("view", { isMaster: false }), false);
  assert.equal(shouldApply("view", { role: "follower", followView: false }), false);
  assert.equal(shouldApply("view", { role: "follower", followView: true }), true);
});

test("policy: what the image looks like follows the master, follow-view or not", () => {
  // Flip, rotate, desaturate, channel, guides, PSD layers. A room that
  // disagrees about these is a room talking past itself.
  for (const kind of ["flip", "rotate", "color", "guides", "layers", "sync"]) {
    assert.equal(isBroadcast(kind, { isMaster: true }), true, kind);
    assert.equal(shouldApply(kind, { role: "follower", followView: false }), true, kind);
    // Still only the master drives, and only a follower obeys.
    assert.equal(isBroadcast(kind, { isMaster: false }), false, kind);
    assert.equal(shouldApply(kind, { role: "free", followView: true }), false, kind);
  }
});

test("policy: annotation and presence always travel, whatever the role", () => {
  for (const kind of ["stroke", "ink", "laser", "hello", "ping"]) {
    assert.equal(isBroadcast(kind, { isMaster: false }), true, kind);
    assert.equal(shouldApply(kind, { role: "free", followView: false }), true, kind);
  }
});

test("reducer: guides are viewer state, so they travel like any other action", () => {
  const withGrid = reduceViewer(DEFAULT_VIEWER_STATE, { a: "guides", mode: "grid" }, { items: [] });
  assert.equal(withGrid.guides, "grid");
  assert.equal(DEFAULT_VIEWER_STATE.guides, "none", "no mutation of the default");
  const back = reduceViewer(withGrid, { a: "guides", mode: "none" }, { items: [] });
  assert.equal(back.guides, "none");
});

test("policy: a free peer ignores remote transport", () => {
  assert.equal(shouldApply("seek", { role: "follower", followView: false }), true);
  assert.equal(shouldApply("seek", { role: "free", followView: false }), false);
  assert.equal(shouldApply("seek", { role: "master", followView: false }), false);
});

// ── RGBE ─────────────────────────────────────────────────────────────────────
// The pack/unpack pair is what carries an EXR's range through an ordinary PNG,
// so it is worth pinning: encode is server-side, decode is in the browser, and
// a drift between them is a silently wrong picture rather than a crash.

const { floatsToRgbe, rgbeToFloat, floatToHalf } = require(path.join(OUT, "rgbe.js"));

function roundTrip(values) {
  const n = values.length;
  const r = Float32Array.from(values);
  const out = new Uint8Array(n * 4);
  floatsToRgbe(r, r, r, out);
  return Array.from({ length: n }, (_, i) => rgbeToFloat(out, i * 4)[0]);
}

test("rgbe: values above 1.0 survive, which is the whole point", () => {
  const input = [1.5, 2.26, 8, 64, 1000];
  for (const [i, back] of roundTrip(input).entries()) {
    const rel = Math.abs(back - input[i]) / input[i];
    assert.ok(rel < 0.005, `${input[i]} → ${back} (${(rel * 100).toFixed(2)}%)`);
  }
});

test("rgbe: shadow detail keeps its precision too", () => {
  const input = [0.5, 0.1, 0.01, 0.001, 0.0001];
  for (const [i, back] of roundTrip(input).entries()) {
    const rel = Math.abs(back - input[i]) / input[i];
    assert.ok(rel < 0.005, `${input[i]} → ${back} (${(rel * 100).toFixed(2)}%)`);
  }
});

test("rgbe: zero and NaN pack to the null pixel rather than a stray exponent", () => {
  const n = 2;
  const src = Float32Array.from([0, NaN]);
  const out = new Uint8Array(n * 4);
  floatsToRgbe(src, src, src, out);
  for (let i = 0; i < n; i++) {
    assert.deepEqual(Array.from(out.subarray(i * 4, i * 4 + 4)), [0, 0, 0, 0]);
    assert.deepEqual(rgbeToFloat(out, i * 4), [0, 0, 0]);
  }
});

test("rgbe: a shared exponent tracks the brightest channel", () => {
  // Green dominates, so red and blue are encoded against green's exponent and
  // are allowed to be coarser in relative terms — but not in absolute ones.
  const r = Float32Array.from([0.02]);
  const g = Float32Array.from([4.0]);
  const b = Float32Array.from([0.5]);
  const out = new Uint8Array(4);
  floatsToRgbe(r, g, b, out);
  const [br, bg, bb] = rgbeToFloat(out, 0);
  assert.ok(Math.abs(bg - 4.0) / 4.0 < 0.005, `green ${bg}`);
  for (const [got, want] of [[br, 0.02], [bb, 0.5]]) {
    assert.ok(Math.abs(got - want) / 4.0 < 0.005, `${want} → ${got} vs peak 4.0`);
  }
});

test("floatToHalf: the values a render actually contains", () => {
  const bits = (v) => floatToHalf(v);
  assert.equal(bits(0), 0x0000);
  assert.equal(bits(1), 0x3c00);
  assert.equal(bits(2), 0x4000);
  assert.equal(bits(-1), 0xbc00);
  assert.equal(bits(65504), 0x7bff, "largest finite half");
  assert.equal(bits(1e6), 0x7c00, "overflow saturates to infinity, not garbage");
  assert.equal(bits(1e-9), 0x0000, "underflow to zero, sign preserved separately");
});

// ── Working-space conversion ──────────────────────────────────────────────────

const {
  PRIMARIES, rgbToXyz, toSrgbMatrix, toGl, IDENTITY,
} = require(path.join(OUT, "primaries.js"));

/** Compare a derived matrix against published figures. */
function closeTo(actual, expected, tol, label) {
  for (let i = 0; i < 9; i++) {
    assert.ok(
      Math.abs(actual[i] - expected[i]) < tol,
      `${label}[${i}] was ${actual[i].toFixed(6)}, expected ${expected[i]}`,
    );
  }
}

test("rgbToXyz: sRGB derives the published D65 matrix", () => {
  // IEC 61966-2-1. Deriving this rather than pasting it is what makes every
  // other space in the table trustworthy — the construction is checked against
  // the one matrix everybody agrees on.
  closeTo(rgbToXyz(PRIMARIES.srgb), [
    0.4124, 0.3576, 0.1805,
    0.2126, 0.7152, 0.0722,
    0.0193, 0.1192, 0.9505,
  ], 5e-5, "srgb→xyz");
});

test("toSrgbMatrix: ACES2065-1 matches the published conversion", () => {
  closeTo(toSrgbMatrix("aces2065-1"), [
    2.52169, -1.13413, -0.38756,
    -0.27648, 1.37272, -0.09624,
    -0.01538, -0.15298, 1.16835,
  ], 1e-4, "ap0→srgb");
});

test("toSrgbMatrix: ACEScg matches the published conversion", () => {
  closeTo(toSrgbMatrix("acescg"), [
    1.70505, -0.62179, -0.08326,
    -0.13026, 1.14080, -0.01055,
    -0.02400, -0.12897, 1.15297,
  ], 1e-4, "ap1→srgb");
});

test("toSrgbMatrix: Display-P3 agrees with the matrix already in the shader", () => {
  // The shader carries P3_TO_SRGB as a literal for the output path. If these
  // two ever disagree, one of them is wrong.
  closeTo(toSrgbMatrix("display-p3"), [
    1.2249401, -0.2249404, 0,
    -0.0420569, 1.042057, 0,
    -0.0196376, -0.0786361, 1.0982735,
  ], 1e-4, "p3→srgb");
});

test("toSrgbMatrix: white stays white in every named space", () => {
  // The whole point of the chromatic adaptation. A D60 space converted without
  // it puts a warm cast on everything.
  for (const name of Object.keys(PRIMARIES)) {
    const m = toSrgbMatrix(name);
    for (let r = 0; r < 3; r++) {
      const sum = m[r * 3] + m[r * 3 + 1] + m[r * 3 + 2];
      assert.ok(Math.abs(sum - 1) < 1e-6, `${name} row ${r} maps white to ${sum}`);
    }
  }
});

test("toSrgbMatrix: sRGB and Rec.709 are identity, not a near miss", () => {
  assert.deepEqual([...toSrgbMatrix("srgb")], [...IDENTITY]);
  for (const [i, v] of toSrgbMatrix("bt709").entries()) {
    assert.ok(Math.abs(v - IDENTITY[i]) < 1e-12);
  }
});

test("toSrgbMatrix: an unknown or absent gamut is left alone", () => {
  // Guessing would be worse than doing nothing: untouched is at least a state
  // the colourist can reason about.
  assert.deepEqual([...toSrgbMatrix(undefined)], [...IDENTITY]);
  assert.deepEqual([...toSrgbMatrix("unknown")], [...IDENTITY]);
  assert.deepEqual([...toSrgbMatrix("")], [...IDENTITY]);
});

test("toSrgbMatrix: an ACES red lands outside the sRGB gamut", () => {
  // Not a round number to check, but the property that matters: AP0 red is far
  // outside anything a monitor shows, so it must come out with the negative
  // green and blue that says "out of gamut" rather than a plausible red.
  const m = toSrgbMatrix("aces2065-1");
  const red = [m[0], m[3], m[6]];
  assert.ok(red[0] > 2, "red channel gains");
  assert.ok(red[1] < 0 && red[2] < 0, "green and blue go negative");
});

test("toGl: row-major becomes the column-major order GL wants", () => {
  const gl = toGl([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual([...gl], [1, 4, 7, 2, 5, 8, 3, 6, 9]);
});
