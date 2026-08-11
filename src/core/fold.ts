import type { LoopMode } from "./types";

/**
 * Map an unbounded frame counter onto a clip of `n` frames under a loop mode.
 *
 * Closed form on purpose: a follower must be able to compute its frame directly
 * from a timestamp (see clock.ts) without replaying any state. That is what
 * keeps every screen in the room locked without per-frame network traffic.
 */
export function fold(k: number, n: number, mode: LoopMode): number {
  if (!Number.isFinite(k)) return 0;
  if (n <= 1) return 0;
  const i = Math.floor(k);
  if (mode === "off") return Math.min(Math.max(i, 0), n - 1);
  if (mode === "loop") return ((i % n) + n) % n;
  // bounce: forward 0..n-1 then back down to 1, period 2n-2
  const period = 2 * (n - 1);
  const p = ((i % period) + period) % period;
  return p < n ? p : period - p;
}

/**
 * True when advancing past the end should stop playback.
 * Only `off` terminates; loop and bounce run forever.
 */
export function reachedEnd(k: number, n: number, mode: LoopMode): boolean {
  return mode === "off" && (k >= n - 1 || n <= 1);
}

/**
 * Step one frame in the given direction, respecting the loop mode.
 * Used by frame-step keys, which should wrap under loop/bounce.
 */
export function step(frame: number, delta: number, n: number, mode: LoopMode): number {
  if (mode === "bounce") {
    // Stepping through a bounce should feel linear, not follow the fold — the
    // user pressing "next frame" at the last frame expects to turn around.
    const next = frame + delta;
    if (next < 0) return Math.min(1, n - 1);
    if (next > n - 1) return Math.max(n - 2, 0);
    return next;
  }
  return fold(frame + delta, n, mode === "off" ? "off" : "loop");
}

/** Nearest annotated frame strictly before / after `frame`, or null. */
export function prevMarker(frames: number[], frame: number): number | null {
  let best: number | null = null;
  for (const f of frames) if (f < frame && (best === null || f > best)) best = f;
  return best;
}

export function nextMarker(frames: number[], frame: number): number | null {
  let best: number | null = null;
  for (const f of frames) if (f > frame && (best === null || f < best)) best = f;
  return best;
}
