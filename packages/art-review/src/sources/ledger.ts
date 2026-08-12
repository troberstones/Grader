import { ABSOLUTE_RAM_CEILING } from "../core/budget";

/**
 * One memory ledger for the whole tab.
 *
 * A per-source budget is not a budget: with prefetching, N sources each held
 * their own allowance and the total was N × budget. Every frame buffer now
 * goes through here, so the ceiling is a real ceiling.
 *
 * Callers must `release()` what they `reserve()`. A reserve that fails is
 * normal, not exceptional — it means the cache is full and the source should
 * evict or fall back to window mode.
 */
export class MemoryLedger {
  private used = 0;
  private limit: number;
  private listeners = new Set<() => void>();

  constructor(limit: number) {
    this.limit = Math.min(limit, ABSOLUTE_RAM_CEILING);
  }

  get bytesUsed(): number {
    return this.used;
  }

  get bytesLimit(): number {
    return this.limit;
  }

  get pressure(): number {
    return this.limit > 0 ? this.used / this.limit : 1;
  }

  setLimit(limit: number): void {
    this.limit = Math.min(limit, ABSOLUTE_RAM_CEILING);
    this.emit();
  }

  reserve(bytes: number): boolean {
    if (bytes <= 0) return true;
    if (this.used + bytes > this.limit) return false;
    this.used += bytes;
    this.emit();
    return true;
  }

  release(bytes: number): void {
    if (bytes <= 0) return;
    this.used = Math.max(0, this.used - bytes);
    this.emit();
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

/**
 * The tab-wide ledger. A module singleton on purpose: two viewers mounted at
 * once (a review page and a preview, say) must share one ceiling, not get one
 * each.
 */
let shared: MemoryLedger | null = null;

export function sharedLedger(limit?: number): MemoryLedger {
  if (!shared) shared = new MemoryLedger(limit ?? 512 * 1024 * 1024);
  else if (limit !== undefined && limit !== shared.bytesLimit) shared.setLimit(limit);
  return shared;
}

const PREF_KEY = "art-review.cacheBytes";

/**
 * A cache ceiling chosen by hand, if one has been.
 *
 * Detection guesses from the user agent and device memory, which is the right
 * default but cannot know that this particular machine is a review workstation
 * with a 49-frame EXR shot open. Holding a whole shot resident is the
 * difference between smooth playback and a decode on every frame, so the number
 * is worth handing over. Null means "keep detecting".
 */
export function storedCacheLimit(): number | null {
  try {
    const n = Number(localStorage.getItem(PREF_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    // Storage can throw outright in private mode rather than merely being empty.
    return null;
  }
}

/** Set the ceiling and remember it. Null goes back to detection. */
export function setStoredCacheLimit(bytes: number | null, detected: number): void {
  try {
    if (bytes === null) localStorage.removeItem(PREF_KEY);
    else localStorage.setItem(PREF_KEY, String(bytes));
  } catch {
    // Not being able to remember it should not stop it taking effect now.
  }
  sharedLedger().setLimit(bytes ?? detected);
}
