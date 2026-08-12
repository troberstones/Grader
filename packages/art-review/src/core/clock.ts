import { fold } from "./fold";
import type { LoopMode } from "./types";

/**
 * Shared-clock estimation.
 *
 * Broadcasting the playhead every frame jitters and floods the channel. Instead
 * the master sends one transport snapshot on state change and every follower
 * projects its own frame from a shared timestamp. That requires knowing the
 * offset between the two machines' clocks.
 *
 * Standard NTP-style estimate over a ping/pong:
 *   offset = remote - (send + recv) / 2
 *   rtt    = recv - send
 * The lowest-RTT sample in the window is the least contaminated by queueing, so
 * that is the one we keep rather than a mean.
 */
export class ClockSync {
  private samples: { offset: number; rtt: number; at: number }[] = [];
  private best = { offset: 0, rtt: Infinity };

  /** Milliseconds to add to local time to get the shared epoch. */
  get offset(): number {
    return this.best.offset;
  }

  get rtt(): number | null {
    return Number.isFinite(this.best.rtt) ? this.best.rtt : null;
  }

  /**
   * True once at least one ping/pong has landed.
   *
   * Until then the offset is 0, which silently means "assume both machines
   * agree on the wall clock". They do not — an iPad and a Mac drifting a second
   * apart is 25 frames of error — so callers must not extrapolate across a
   * timestamp from another device before this is true.
   */
  get synced(): boolean {
    return this.samples.length > 0;
  }

  /** Local monotonic-ish wall clock. Date.now() is fine at this precision. */
  now(): number {
    return Date.now();
  }

  /** Shared-epoch time. Master's own offset stays 0, so it defines the epoch. */
  sharedNow(): number {
    return this.now() + this.best.offset;
  }

  sample(sentAt: number, remoteAt: number, receivedAt: number): void {
    const rtt = receivedAt - sentAt;
    if (rtt < 0 || rtt > 5000) return;
    const offset = remoteAt - (sentAt + receivedAt) / 2;
    this.samples.push({ offset, rtt, at: receivedAt });

    // Keep a 2-minute window so a machine that sleeps and wakes re-converges.
    const cutoff = receivedAt - 120_000;
    this.samples = this.samples.filter((s) => s.at >= cutoff);

    let best = this.samples[0];
    for (const s of this.samples) if (s.rtt < best.rtt) best = s;
    this.best = { offset: best.offset, rtt: best.rtt };
  }

  reset(): void {
    this.samples = [];
    this.best = { offset: 0, rtt: Infinity };
  }
}

export interface TransportSnapshot {
  playing: boolean;
  /** Frame at the instant `at`. */
  frame: number;
  rate: number;
  /** Shared-epoch timestamp. */
  at: number;
}

/**
 * Project a follower's frame from the master's snapshot.
 * Closed form via fold(), so no state replay and no drift accumulation.
 */
export function projectFrame(
  snap: TransportSnapshot,
  sharedNow: number,
  fps: number,
  frameCount: number,
  loop: LoopMode,
): number {
  if (!snap.playing) return fold(snap.frame, frameCount, loop);
  const elapsed = (sharedNow - snap.at) / 1000;
  return fold(snap.frame + elapsed * fps * snap.rate, frameCount, loop);
}

/**
 * How far off a follower is, in frames. Used to decide between a hard seek and
 * letting it ride: correcting a sub-2-frame error is more visible than the
 * error itself.
 */
export const DRIFT_TOLERANCE_FRAMES = 2;

export function needsResync(current: number, target: number, frameCount: number, loop: LoopMode): boolean {
  let delta = Math.abs(current - target);
  if (loop === "loop" && frameCount > 1) {
    // A wrap looks like a huge delta but is not drift.
    delta = Math.min(delta, frameCount - delta);
  }
  return delta > DRIFT_TOLERANCE_FRAMES;
}
