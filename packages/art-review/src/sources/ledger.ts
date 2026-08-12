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
