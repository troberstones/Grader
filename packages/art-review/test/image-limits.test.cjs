/**
 * Header-only dimension guards for PSD and EXR ingest.
 *
 * ag-psd and the vendored EXR decoder both allocate a full-resolution buffer
 * as part of *parsing* a file — there is no cheap partial-parse entry point in
 * either. So a tiny, crafted file that merely *declares* an enormous canvas in
 * its header can exhaust memory before either library gets a chance to reject
 * anything. These tests exercise exactly the bytes that check runs against:
 * hand-built headers, no real PSD/EXR payload needed, and no ag-psd, sharp or
 * EXR decompression pulled in — see scripts/build-test.sh for why psd.ts and
 * exr.ts are safe to compile for this without pulling those in.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const OUT = path.join(__dirname, ".build");
const { peekExrDimensions } = require(path.join(OUT, "server", "exr.js"));
const { readPsdHeaderDimensions } = require(path.join(OUT, "server", "psd.js"));
const {
  assertWithinImageLimits,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_MEGAPIXELS,
} = require(path.join(OUT, "server", "image-limits.js"));

// ── header builders ────────────────────────────────────────────────────────

function cstr(s) {
  return Buffer.concat([Buffer.from(s, "ascii"), Buffer.from([0])]);
}

/** Just enough of an EXR file for peekExrDimensions: magic, version, one dataWindow attribute. */
function makeExrHeader(width, height) {
  const magic = Buffer.from([0x76, 0x2f, 0x31, 0x01]); // 0x01312f76 little-endian
  const version = Buffer.from([2, 0, 0, 0]);
  const name = cstr("dataWindow");
  const type = cstr("box2i");
  const size = Buffer.alloc(4);
  size.writeInt32LE(16, 0);
  const box = Buffer.alloc(16);
  box.writeInt32LE(0, 0); // xMin
  box.writeInt32LE(0, 4); // yMin
  box.writeInt32LE(width - 1, 8); // xMax
  box.writeInt32LE(height - 1, 12); // yMax
  const terminator = Buffer.from([0]); // zero-length name ends the attribute list
  const buf = Buffer.concat([magic, version, name, type, size, box, terminator]);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** Just the fixed 26-byte PSD/PSB header readPsdHeaderDimensions actually reads. */
function makePsdHeader(width, height) {
  const b = Buffer.alloc(26);
  b.write("8BPS", 0, "ascii");
  b.writeUInt16BE(1, 4); // version
  b.writeUInt16BE(3, 12); // channel count
  b.writeUInt32BE(height, 14);
  b.writeUInt32BE(width, 18);
  return b;
}

// ── EXR header parsing ──────────────────────────────────────────────────────

test("peekExrDimensions reads width/height from a minimal dataWindow attribute", () => {
  assert.deepEqual(peekExrDimensions(makeExrHeader(640, 480)), { width: 640, height: 480 });
});

test("peekExrDimensions rejects a bad magic number without touching the rest of the buffer", () => {
  assert.throws(() => peekExrDimensions(Buffer.from("definitely not an exr").buffer), /bad magic/);
});

test("peekExrDimensions rejects a header with no dataWindow attribute", () => {
  const magic = Buffer.from([0x76, 0x2f, 0x31, 0x01]);
  const version = Buffer.from([2, 0, 0, 0]);
  const terminator = Buffer.from([0]);
  const buf = Buffer.concat([magic, version, terminator]);
  assert.throws(
    () => peekExrDimensions(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
    /no dataWindow/,
  );
});

// ── PSD header parsing ───────────────────────────────────────────────────────

test("readPsdHeaderDimensions reads width/height from the fixed header", () => {
  assert.deepEqual(readPsdHeaderDimensions(makePsdHeader(900, 700)), { width: 900, height: 700 });
});

test("readPsdHeaderDimensions rejects a bad signature", () => {
  assert.throws(() => readPsdHeaderDimensions(Buffer.alloc(30)), /bad signature/);
});

test("readPsdHeaderDimensions rejects a buffer shorter than the fixed header", () => {
  assert.throws(() => readPsdHeaderDimensions(Buffer.from("8BPS")), /bad signature/);
});

// ── the shared limit, and the two ingest paths' use of it ───────────────────

test("assertWithinImageLimits passes ordinary art-asset sizes", () => {
  assert.doesNotThrow(() => assertWithinImageLimits(4096, 4096, "test"));
});

test("assertWithinImageLimits rejects a side over MAX_IMAGE_DIMENSION", () => {
  assert.throws(
    () => assertWithinImageLimits(MAX_IMAGE_DIMENSION + 1, 100, "test"),
    /exceeds the/,
  );
});

test("assertWithinImageLimits rejects a canvas over MAX_IMAGE_MEGAPIXELS even with both sides individually legal", () => {
  // Each side alone is under the per-side cap, but the product isn't.
  const side = Math.floor(Math.sqrt(MAX_IMAGE_MEGAPIXELS * 1_000_000)) + 200;
  assert.ok(side <= MAX_IMAGE_DIMENSION, "test assumption: side must stay under the per-side cap");
  assert.throws(() => assertWithinImageLimits(side, side, "test"), /exceeds the/);
});

test("an oversized EXR header is rejected before any real decode would run", () => {
  const dims = peekExrDimensions(makeExrHeader(30000, 30000));
  assert.throws(() => assertWithinImageLimits(dims.width, dims.height, "exr"), /exr:.*exceeds the/);
});

test("an oversized PSD header is rejected before any real decode would run", () => {
  const dims = readPsdHeaderDimensions(makePsdHeader(30000, 30000));
  assert.throws(() => assertWithinImageLimits(dims.width, dims.height, "psd"), /psd:.*exceeds the/);
});

test("a legitimately large but in-budget EXR header is accepted", () => {
  const dims = peekExrDimensions(makeExrHeader(8192, 4320)); // 8K-ish, ~35MP
  assert.doesNotThrow(() => assertWithinImageLimits(dims.width, dims.height, "exr"));
});
