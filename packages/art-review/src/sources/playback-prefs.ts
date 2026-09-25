import type { VideoQuality } from "../core/budget";

/**
 * Video playback choices remembered per browser, like the cache ceiling in
 * ./ledger.ts: they describe this machine and this reviewer's eyes, not the
 * session, so they never travel on the sync bus.
 */

const QUALITY_KEY = "art-review.videoQuality";
const SHARPEN_KEY = "art-review.sharpenOnPause";

export function storedVideoQuality(): VideoQuality {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    if (v === "full") return "full";
    const n = Number(v);
    return v && Number.isFinite(n) && n > 0 ? n : "auto";
  } catch {
    return "auto";
  }
}

export function setStoredVideoQuality(q: VideoQuality): void {
  try {
    if (q === "auto") localStorage.removeItem(QUALITY_KEY);
    else localStorage.setItem(QUALITY_KEY, String(q));
  } catch {
    // Not remembering it should not stop it taking effect now.
  }
}

/** On by default: a paused frame is what gets looked at and drawn on. */
export function storedSharpenOnPause(): boolean {
  try {
    return localStorage.getItem(SHARPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setStoredSharpenOnPause(on: boolean): void {
  try {
    localStorage.setItem(SHARPEN_KEY, on ? "1" : "0");
  } catch {
    // As above.
  }
}
