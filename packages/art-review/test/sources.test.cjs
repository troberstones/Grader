/**
 * Lifecycle tests for the frame-source layer.
 *
 * These exist because the same class of bug — a source that never paints —
 * cost a long stretch of browser instrumentation that kept reading stale code
 * and pointing at the wrong thing. The source layer touches only four browser
 * globals, all of which a test can stand in for, so it can be pinned down here
 * where a failure is a failure rather than a maybe.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const OUT = path.join(__dirname, ".build");

// ── browser stand-ins ────────────────────────────────────────────────────────

/** Whatever the test last registered for a url, plus a hold for slow loads. */
const images = new Map();
let fetches = [];
let bitmapCalls = [];

class FakeBitmap {
  constructor(width, height, rgbe) {
    this.width = width;
    this.height = height;
    this.rgbe = rgbe ?? null;
    this.closed = false;
  }
  close() {
    this.closed = true;
  }
}

/** Register an image; `gate` (if given) is awaited before it decodes. */
function serve(url, width, height, opts = {}) {
  images.set(url, { width, height, ...opts });
}

/** A promise plus its resolve/reject, for holding a load open mid-flight. */
function gate() {
  let open, fail;
  const promise = new Promise((res, rej) => {
    open = res;
    fail = rej;
  });
  return { promise, open, fail };
}

function installGlobals() {
  globalThis.fetch = async (url) => {
    fetches.push(url);
    const entry = images.get(url);
    if (!entry) return { ok: false, status: 404 };
    return { ok: true, status: 200, blob: async () => ({ __url: url }) };
  };

  globalThis.createImageBitmap = async (src, opts = {}) => {
    bitmapCalls.push({ src, opts });
    // Resize path: the caller hands back a bitmap it already decoded.
    if (src instanceof FakeBitmap) {
      return new FakeBitmap(opts.resizeWidth, opts.resizeHeight, src.rgbe);
    }
    const entry = images.get(src.__url);
    if (entry.gate) await entry.gate.promise;
    if (entry.throws) throw new Error(entry.throws);
    return new FakeBitmap(entry.width, entry.height, entry.rgbe);
  };

  // Only halfFloatOf needs this, and only to hand back the bytes unchanged.
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      let drawn = null;
      return {
        drawImage: (bmp) => {
          drawn = bmp;
        },
        getImageData: (_x, _y, w, h) => ({
          data: drawn?.rgbe ?? new Uint8ClampedArray(w * h * 4),
        }),
      };
    }
  };
}

installGlobals();

const { BitmapCacheSource, halfFloatOf } = require(path.join(OUT, "sources", "bitmap-cache.js"));
const { StillSource, SequenceSource } = require(path.join(OUT, "sources", "still.js"));
const { RGBE_TRANSFER } = require(path.join(OUT, "core", "rgbe.js"));
const { frameNumberOf, sequenceFrames } = require(path.join(OUT, "server", "ingest.js"));
const { sharedLedger } = require(path.join(OUT, "sources", "ledger.js"));

/**
 * Sources subscribe to the shared ledger for the lifetime of the source, so one
 * left undisposed keeps trimming its own cache when a later test moves the
 * ceiling — which showed up as a trim that stopped early for no visible reason.
 */
const live = [];
function track(src) {
  live.push(src);
  return src;
}

function reset() {
  for (const s of live.splice(0)) s.dispose();
  images.clear();
  fetches = [];
  bitmapCalls = [];
  // The ledger is a module singleton by design, so a source left undisposed by
  // an earlier test would otherwise charge its frames to the next one.
  const ledger = sharedLedger();
  ledger.release(ledger.bytesUsed);
  ledger.setLimit(1024 * 1024 * 1024);
}

const CTX = {
  maxCacheWidth: 4096,
  ramBudget: 1 << 30,
  viewportWidth: 1600,
  pdfWorkerUrl: "/pdf.worker.js",
};

function still(over = {}) {
  return {
    id: "sub:1",
    label: "test.png",
    kind: "still",
    url: "/media/1.png",
    width: 1920,
    height: 1080,
    frameCount: 1,
    ...over,
  };
}

/** Let every already-resolved microtask drain. */
const settle = () => new Promise((r) => setTimeout(r, 0));

// ── the happy path, so a failure below means something ───────────────────────

test("still: a requested frame lands in the cache and peeks exact", async () => {
  reset();
  serve("/media/1.png", 1920, 1080);
  const src = track(new StillSource(still(), CTX));

  assert.equal(src.peek(0), null, "nothing to show before the decode finishes");
  await src.request(0);

  const ref = src.peek(0);
  assert.ok(ref, "peek returns a frame once decoded");
  assert.equal(ref.exact, true);
  assert.equal(ref.tex.type, "bitmap");
  assert.equal(ref.tex.width, 1920);
  assert.equal(src.stats().cached, 1);
});

test("still: peeking every frame while a decode is in flight loads once", async () => {
  reset();
  const g = gate();
  serve("/media/1.png", 1920, 1080, { gate: g });
  const src = track(new StillSource(still(), CTX));

  for (let i = 0; i < 30; i++) src.peek(0);
  await settle();
  assert.equal(fetches.length, 1, "one fetch, not thirty");

  g.open();
  await settle();
  assert.ok(src.peek(0), "and it paints once the gate opens");
});

// ── the lifecycle that was actually suspected ────────────────────────────────

test("still: disposing mid-flight settles the request and closes the bitmap", async () => {
  reset();
  const g = gate();
  serve("/media/1.png", 1920, 1080, { gate: g });
  const src = track(new StillSource(still(), CTX));

  const pending = src.request(0);
  src.dispose();
  g.open();

  // The point: this await must not hang. A request that never settles is
  // exactly what a stuck source looks like from the render loop.
  await pending;
  await settle();

  assert.equal(src.stats().cached, 0);
  assert.equal(src.stats().decoding, false, "nothing left in flight");
  const decoded = bitmapCalls.map((c) => c.result).filter(Boolean);
  assert.equal(decoded.every((b) => b.closed), true);
});

test("still: a replacement source for the same item loads after the first is disposed", async () => {
  // This is the double-mount shape: the effect creates one source, the cleanup
  // disposes it and clears the map, and the second pass creates another. The
  // replacement must not inherit anything from the discarded instance.
  reset();
  const g = gate();
  serve("/media/1.png", 1920, 1080, { gate: g });

  const first = track(new StillSource(still(), CTX));
  void first.request(0);
  first.dispose();

  const second = track(new StillSource(still(), CTX));
  const pending = second.request(0);
  g.open();
  await pending;

  assert.equal(second.stats().cached, 1, "the live source has its frame");
  assert.equal(first.stats().cached, 0, "the discarded one kept nothing");
  const ref = second.peek(0);
  assert.ok(ref && ref.exact);
});

test("still: a source disposed before any request never starts one", async () => {
  reset();
  serve("/media/1.png", 1920, 1080);
  const src = track(new StillSource(still(), CTX));
  src.dispose();

  await src.request(0);
  await settle();
  assert.equal(fetches.length, 0, "a disposed source does not fetch");
  assert.equal(src.peek(0), null);
});

test("still: a failed decode surfaces as an error rather than a permanent stall", async () => {
  reset();
  serve("/media/1.png", 1920, 1080, { throws: "corrupt" });
  const src = track(new StillSource(still(), CTX));

  await src.request(0);
  const stats = src.stats();
  assert.match(stats.error ?? "", /corrupt/);
  assert.equal(stats.decoding, false, "the inflight entry is cleared");
  assert.equal(stats.cached, 0);
});

// ── HDR ──────────────────────────────────────────────────────────────────────

const HDR_ITEM = () =>
  still({
    id: "sub:2",
    url: "/media/2.png",
    label: "render.exr",
    colorSpace: { transfer: RGBE_TRANSFER, primaries: "aces2065-1" },
  });

test("hdr: an RGBE still is never downscaled, however wide it is", async () => {
  reset();
  // Well past the cap, which for an ordinary still would force a resize.
  serve("/media/2.png", 8192, 4320, { rgbe: new Uint8ClampedArray(8192 * 4320 * 4) });
  const src = track(new StillSource(HDR_ITEM({ width: 8192, height: 4320 }), CTX));
  await src.request(0);

  const resized = bitmapCalls.filter((c) => c.opts.resizeWidth);
  assert.equal(resized.length, 0, "resampling a shared exponent is not a colour operation");
});

test("still: an oversized ordinary still is downscaled to the cap", async () => {
  reset();
  serve("/media/1.png", 8192, 4320);
  const src = track(new StillSource(still({ width: 8192, height: 4320 }), CTX));
  await src.request(0);

  const resized = bitmapCalls.filter((c) => c.opts.resizeWidth);
  assert.equal(resized.length, 1);
  assert.equal(resized[0].opts.resizeWidth, 4096);
});

test("hdr: peek hands the renderer unpacked half-float, not RGBE bytes", async () => {
  reset();
  // One pixel: mid-grey at exponent 128 → 0.5 linear in each channel.
  const rgbe = new Uint8ClampedArray([128, 128, 128, 128]);
  serve("/media/2.png", 1, 1, { rgbe });
  const src = track(new StillSource(HDR_ITEM({ width: 1, height: 1 }), CTX));
  await src.request(0);

  const ref = src.peek(0);
  assert.equal(ref.tex.type, "half", "RGBE bytes would read as colour in the shader");
  assert.ok(ref.tex.data instanceof Uint16Array);
});

test("hdr: the unpack runs once per frame, not once per repaint", async () => {
  reset();
  const rgbe = new Uint8ClampedArray([128, 128, 128, 128]);
  serve("/media/2.png", 1, 1, { rgbe });
  const src = track(new StillSource(HDR_ITEM({ width: 1, height: 1 }), CTX));
  await src.request(0);

  const a = src.peek(0).tex;
  for (let i = 0; i < 20; i++) src.peek(0);
  assert.equal(src.peek(0).tex, a, "the same texture object comes back");
});

test("hdr: stats counts both the packed bitmap and the unpacked float", async () => {
  reset();
  serve("/media/2.png", 100, 100, { rgbe: new Uint8ClampedArray(100 * 100 * 4) });
  const src = track(new StillSource(HDR_ITEM({ width: 100, height: 100 }), CTX));
  await src.request(0);
  assert.equal(src.stats().bytes, 100 * 100 * 12);
});

// ── sequence ─────────────────────────────────────────────────────────────────

function sequence(count) {
  const frameUrls = [];
  for (let i = 0; i < count; i++) {
    const url = `/media/seq/${i}.png`;
    frameUrls.push(url);
    serve(url, 640, 360);
  }
  return {
    id: "sub:3",
    label: "shot",
    kind: "sequence",
    url: frameUrls[0],
    frameUrls,
    width: 640,
    height: 360,
    frameCount: count,
  };
}

test("sequence: frames beyond what fits are evicted furthest-first and closed", async () => {
  reset();
  const item = sequence(60);
  const perFrame = 640 * 360 * 4;
  sharedLedger().setLimit(perFrame * 20);
  const src = track(new SequenceSource(item, CTX));

  for (let f = 0; f < 60; f++) await src.request(f);

  const stats = src.stats();
  assert.ok(stats.cached <= 21, `held ${stats.cached} against room for 20`);
  // Eviction is by distance from the frame just decoded, so the tail survives
  // and the frames furthest behind the playhead are the ones that went.
  assert.ok(src.peek(59).exact, "the frame just decoded is still resident");
  assert.equal(src.peek(0).exact, false, "the far end was evicted");
  src.dispose();
});

test("sequence: peek falls back to the nearest resident frame while decoding", async () => {
  reset();
  const item = sequence(10);
  const src = track(new SequenceSource(item, CTX));
  await src.request(0);

  const g = gate();
  images.get(item.frameUrls[5]).gate = g;
  const ref = src.peek(5);
  assert.ok(ref, "something stays on screen rather than flashing to black");
  assert.equal(ref.exact, false);
  assert.equal(ref.frame, 0);

  g.open();
  await settle();
  assert.equal(src.peek(5).exact, true);
});

test("sequence: prefetch fills around the playhead without unbounded fan-out", async () => {
  reset();
  const item = sequence(60);
  const src = track(new SequenceSource(item, CTX));
  src.prefetch(30, 100);
  assert.ok(src.stats().decoding);
  assert.ok(fetches.length <= 4, `fan-out was ${fetches.length}`);
});

/** An HDR sequence at a real render size, with tiny frames to keep it fast. */
function hdrSequence(count, w = 100, h = 100) {
  const item = sequence(count);
  item.width = w;
  item.height = h;
  item.colorSpace = { transfer: RGBE_TRANSFER, primaries: "aces2065-1" };
  for (const url of item.frameUrls) {
    images.get(url).width = w;
    images.get(url).height = h;
    images.get(url).rgbe = new Uint8ClampedArray(w * h * 4);
  }
  return item;
}

test("sequence: an HDR sequence is never downscaled", async () => {
  reset();
  const item = hdrSequence(4, 1920, 1080);
  // A viewport far narrower than the frames, which for an ordinary sequence
  // would trigger the resize path.
  const src = track(new SequenceSource(item, { ...CTX, viewportWidth: 800, maxCacheWidth: 1024 }));

  await src.request(0);
  assert.equal(bitmapCalls.filter((c) => c.opts.resizeWidth).length, 0);
  src.dispose();
});

test("sequence: the shared ledger bounds an HDR window, not the frame count", async () => {
  reset();
  const item = hdrSequence(40);
  const perFrame = 100 * 100 * 12;
  // Room for eight frames — well under the 48-frame count cap, so if the cap
  // were doing the bounding this would sail past it.
  sharedLedger().setLimit(perFrame * 8);

  const src = track(new SequenceSource(item, CTX));
  for (let f = 0; f < 40; f++) await src.request(f);

  const cached = src.stats().cached;
  assert.ok(cached <= 9, `held ${cached} frames against room for 8`);
  assert.ok(cached >= 3, "the window did not collapse to the playhead");

  src.dispose();
  assert.equal(sharedLedger().bytesUsed, 0, "disposal hands every byte back");
});

test("sequence: lowering the ceiling hands memory back straight away", async () => {
  // Otherwise the setting looks broken: the limit moves, the number above it
  // does not, and nothing shrinks until a new frame happens to arrive — which
  // on a paused viewer is never.
  reset();
  const item = hdrSequence(40);
  const perFrame = 100 * 100 * 12;
  sharedLedger().setLimit(perFrame * 30);

  const src = track(new SequenceSource(item, CTX));
  for (let f = 0; f < 30; f++) await src.request(f);
  const before = src.stats().cached;
  assert.ok(before >= 20, `only cached ${before} to start with`);

  sharedLedger().setLimit(perFrame * 8);

  const after = src.stats().cached;
  assert.ok(after <= 9, `still holding ${after} against room for 8`);
  assert.ok(sharedLedger().pressure <= 1, "back inside the new ceiling");
  src.dispose();
});

test("sequence: trimming keeps the frames around the playhead", async () => {
  reset();
  const item = hdrSequence(40);
  const perFrame = 100 * 100 * 12;
  sharedLedger().setLimit(perFrame * 30);

  const src = track(new SequenceSource(item, CTX));
  for (let f = 0; f < 30; f++) await src.request(f);
  src.peek(25); // the playhead is here

  sharedLedger().setLimit(perFrame * 5);

  assert.ok(src.peek(25).exact, "the frame being shown survived");
  assert.equal(src.peek(0).exact, false, "the far end went first");
  src.dispose();
});

test("sequence: a trim never collapses the cache to the playhead alone", async () => {
  // A cache trimmed to nothing makes every step a fresh decode, which is worse
  // than sitting slightly over a ceiling that is only advisory anyway.
  reset();
  const item = hdrSequence(40);
  sharedLedger().setLimit(100 * 100 * 12 * 30);

  const src = track(new SequenceSource(item, CTX));
  for (let f = 0; f < 30; f++) await src.request(f);
  sharedLedger().setLimit(1);

  assert.ok(src.stats().cached >= 3, `collapsed to ${src.stats().cached}`);
  src.dispose();
});

test("sequence: prefetch asks only for frames the window can keep", async () => {
  // Otherwise an idle viewer decodes for ever: prefetch requests 24, memory
  // holds 20, each arrival evicts one that prefetch immediately asks for again.
  reset();
  const item = hdrSequence(40);
  const perFrame = 100 * 100 * 12;
  sharedLedger().setLimit(perFrame * 8);

  const src = track(new SequenceSource(item, CTX));
  await src.request(0);
  fetches = [];
  src.prefetch(0, 30);
  await settle();

  const asked = new Set(fetches);
  assert.ok(asked.size > 0);
  for (const url of asked) {
    const frame = item.frameUrls.indexOf(url);
    assert.ok(frame <= 4, `prefetched frame ${frame}, beyond a window of 8`);
  }
  src.dispose();
});

test("sequence: a shot that fits is held whole", async () => {
  // The point of exposing the cache size at all. Twelve times the room an HDR
  // window needs, because a plain frame is a twelfth the cost — the same
  // ledger, a very different number of frames.
  reset();
  const item = sequence(60);
  sharedLedger().setLimit(640 * 360 * 4 * 64);

  const src = track(new SequenceSource(item, CTX));
  for (let f = 0; f < 60; f++) await src.request(f);

  assert.equal(src.stats().cached, 60, "no arbitrary count cap short of the clip");
  assert.equal(src.stats().mode, "full");
  src.dispose();
});

// ── frame numbering ──────────────────────────────────────────────────────────

test("frameNumberOf: the frame field is the last number, not the first", () => {
  assert.equal(frameNumberOf("sh0070_bg01_v03.1001.exr"), 1001);
  assert.equal(frameNumberOf("shot.v03.0001.exr"), 1);
  assert.equal(frameNumberOf("render_0042.png"), 42);
  assert.equal(frameNumberOf("beauty.exr"), null);
});

test("sequenceFrames: orders by number, so 1000 does not sort before 999", async () => {
  const { mkdtemp, writeFile } = require("node:fs/promises");
  const os = require("node:os");
  const dir = await mkdtemp(path.join(os.tmpdir(), "seq-"));
  // Deliberately written out of order, and spanning the digit-count boundary
  // that breaks a plain name sort.
  for (const n of [1000, 998, 1001, 999]) {
    await writeFile(path.join(dir, `shot.${n}.exr`), "");
  }
  await writeFile(path.join(dir, "notes.txt"), "");
  await writeFile(path.join(dir, ".DS_Store"), "");

  const frames = (await sequenceFrames(dir)).map((f) => path.basename(f));
  assert.deepEqual(frames, ["shot.998.exr", "shot.999.exr", "shot.1000.exr", "shot.1001.exr"]);
});

test("sequenceFrames: ignores files that are not frames", async () => {
  const { mkdtemp, writeFile } = require("node:fs/promises");
  const os = require("node:os");
  const dir = await mkdtemp(path.join(os.tmpdir(), "seq-"));
  await writeFile(path.join(dir, "shot.0001.exr"), "");
  await writeFile(path.join(dir, "shot.0002.png"), "");
  await writeFile(path.join(dir, "shot.mp4"), "");
  await writeFile(path.join(dir, "unnumbered.exr"), "");

  const frames = (await sequenceFrames(dir)).map((f) => path.basename(f));
  assert.deepEqual(frames, ["shot.0001.exr", "shot.0002.png"]);
});

// ── the raw unpack, independent of any source ────────────────────────────────

test("halfFloatOf: a mid-grey RGBE pixel unpacks to a half-float half", () => {
  const bmp = new FakeBitmap(1, 1, new Uint8ClampedArray([128, 128, 128, 128]));
  const tex = halfFloatOf(bmp);
  assert.equal(tex.type, "half");
  assert.equal(tex.width, 1);
  assert.equal(tex.data.length, 4);
  assert.equal(tex.data[3], 0x3c00, "alpha is opaque, not the exponent");
});

test("BitmapCacheSource: onChange fires when a frame arrives and unsubscribes cleanly", async () => {
  reset();
  serve("/media/1.png", 8, 8);
  const src = track(new StillSource(still(), CTX));
  let hits = 0;
  const off = src.onChange(() => hits++);
  await src.request(0);
  assert.equal(hits, 1);

  off();
  src.dispose();
  const again = track(new StillSource(still(), CTX));
  await again.request(0);
  assert.equal(hits, 1, "a stale listener does not keep being called");
});
