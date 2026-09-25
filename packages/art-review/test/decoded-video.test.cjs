/**
 * Dispose/abort lifecycle for the decoded-video source.
 *
 * A skipped student's video used to keep pulling its whole proxy file over the
 * wire and burning CPU on mp4box/VideoDecoder for a viewer nobody was looking
 * at — see the `abortController` field in decoded-video.ts. These tests stand
 * in for `fetch` and `mp4box` the same way sources.test.cjs stands in for
 * `Image`/`createImageBitmap`, and check the one thing that actually matters:
 * dispose() reaches the in-flight request and run() never surfaces that as an
 * error once dispose() was the cause.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const OUT = path.join(__dirname, ".build");

const { DecodedVideoSource } = require(path.join(OUT, "sources", "decoded-video.js"));
const { MemoryLedger } = require(path.join(OUT, "sources", "ledger.js"));
const { BUDGETS } = require(path.join(OUT, "core", "budget.js"));

const CTX = {
  maxCacheWidth: 1920,
  ramBudget: 1 << 30,
  viewportWidth: 1600,
  pdfWorkerUrl: "/pdf.worker.js",
};

function item(over = {}) {
  return {
    id: "sub:1",
    label: "clip.mp4",
    kind: "video",
    url: "/media/clip.mp4",
    width: 1920,
    height: 1080,
    frameCount: 120,
    ...over,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

/**
 * A `fetch` that never resolves on its own and remembers the signal it was
 * given, so a test can assert on both "was a signal passed" and "did dispose()
 * actually abort it" — plus, like a real fetch, rejects with an AbortError
 * once that signal fires.
 */
function installHangingFetch() {
  let capturedSignal = null;
  let callCount = 0;
  globalThis.fetch = (_url, opts) => {
    callCount++;
    capturedSignal = opts?.signal ?? null;
    return new Promise((_resolve, reject) => {
      capturedSignal?.addEventListener("abort", () => {
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        reject(err);
      });
    });
  };
  return {
    get signal() {
      return capturedSignal;
    },
    get callCount() {
      return callCount;
    },
  };
}

test("dispose() aborts the in-flight fetch before it resolves", async () => {
  const fetchSpy = installHangingFetch();
  const ledger = new MemoryLedger(1 << 30);
  const src = new DecodedVideoSource(item(), CTX, BUDGETS.workstation, ledger);

  const readyPromise = src.ready();
  await settle(); // let run() reach the fetch() call

  assert.equal(fetchSpy.callCount, 1, "run() should have started exactly one fetch");
  assert.ok(fetchSpy.signal instanceof AbortSignal, "fetch should be called with an AbortSignal");
  assert.equal(fetchSpy.signal.aborted, false, "not aborted yet");

  src.dispose();
  assert.equal(fetchSpy.signal.aborted, true, "dispose() aborts the download's AbortController");

  // "dispose() aborted this on purpose" — ready() must not surface the
  // resulting AbortError as a source error once disposed.
  await assert.doesNotReject(readyPromise);
  assert.equal(src.stats().error, undefined);
});

test("dispose() before any frame is ever requested never touches the network", async () => {
  const fetchSpy = installHangingFetch();
  const ledger = new MemoryLedger(1 << 30);
  const src = new DecodedVideoSource(item(), CTX, BUDGETS.workstation, ledger);

  // Nothing has called ready()/request() yet — the download is lazy — so
  // disposing here must not be the thing that kicks it off.
  src.dispose();
  await settle();

  assert.equal(fetchSpy.callCount, 0);
});

test("a fetch failure unrelated to dispose still surfaces as a source error", async () => {
  globalThis.fetch = () => Promise.reject(new Error("network down"));
  const ledger = new MemoryLedger(1 << 30);
  const src = new DecodedVideoSource(item(), CTX, BUDGETS.workstation, ledger);

  await assert.rejects(src.ready(), /network down/);
  assert.equal(src.stats().error, "network down");

  src.dispose();
});
