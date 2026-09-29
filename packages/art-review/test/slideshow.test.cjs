/**
 * Slideshow detection's pure parts: which distinct frames count as slides,
 * and where an annotation on a video frame lands once the video is stills.
 * The ffmpeg side is exercised by hand against real files; see slideshow.ts.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const OUT = path.join(__dirname, ".build", "server");
const { slidesFrom, slideOf } = require(path.join(OUT, "slideshow.js"));

test("slidesFrom: evenly held stills are all slides", () => {
  // Julianna's video: a new image roughly every 149 frames.
  const starts = [0, 149, 298, 447, 596, 745, 894, 1043, 1122, 1271];
  const slides = slidesFrom(starts, 1341);
  assert.equal(slides.length, 10);
  assert.deepEqual(slides[9], { start: 1271, hold: 70 });
});

test("slidesFrom: crossfade frames drop out, the held images stay", () => {
  const fade = (from, n) => Array.from({ length: n }, (_, i) => from + i);
  const starts = [0, ...fade(60, 30), ...fade(120, 30), 150];
  const slides = slidesFrom(starts, 210);
  assert.deepEqual(slides.map((s) => s.start), [0, 89, 150]);
});

test("slidesFrom: mostly motion is not a slideshow", () => {
  const starts = [0, ...Array.from({ length: 120 }, (_, i) => 40 + i), 160];
  assert.equal(slidesFrom(starts, 200), null);
});

test("slidesFrom: one image held throughout is not a slideshow", () => {
  assert.equal(slidesFrom([0], 300), null);
});

test("slideOf: maps a video frame to the slide on screen", () => {
  const starts = [0, 90, 180];
  assert.equal(slideOf(0, starts), 0);
  assert.equal(slideOf(89, starts), 0);
  assert.equal(slideOf(90, starts), 1);
  assert.equal(slideOf(5000, starts), 2);
});

test("slideOf: a frame before the first slide (a fade-in) goes to the first", () => {
  assert.equal(slideOf(3, [12, 90]), 0);
});
