/**
 * A process-wide concurrency limiter, no dependency needed.
 *
 * Used to cap how many ffmpeg transcodes run at once (src/actions/review.ts)
 * — without it, opening a review page for a student with a dozen submissions
 * fires a dozen concurrent ffmpeg processes, which is how a single page load
 * pins every CPU core and starves the rest of the app.
 */
export class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly max: number) {
    if (max < 1) throw new Error("Semaphore max must be at least 1");
  }

  /** Runs `fn` once a slot is free, releasing the slot when it settles either way. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}
