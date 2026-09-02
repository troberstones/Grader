import type { CacheStats, FrameRef, FrameSource, TexSource } from "./types";
import type { LoopMode, ReviewItem } from "../core/types";

/**
 * `<video>` fallback for browsers without WebCodecs.
 *
 * Two modes, because neither alone is enough:
 *  - forward playback at a positive rate uses native play(), and the *source*
 *    drives the playhead (via requestVideoFrameCallback where available).
 *    Seeking 24 times a second would thrash.
 *  - scrubbing, stepping, and bounce's reverse half pause the element and seek.
 *    `playbackRate` cannot go negative in any browser, so reverse has no other
 *    option here. All-intra proxies are what make it tolerable.
 */
export class VideoElementSource implements FrameSource {
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;

  private video: HTMLVideoElement;
  private listeners = new Set<() => void>();
  private version = 0;
  private disposed = false;
  private error: string | undefined;
  private loadedPromise: Promise<void> | null = null;
  private nativePlayback = false;
  private rvfcHandle: number | null = null;
  private lastSeekFrame = -1;
  private seekPending = false;
  private queuedSeek: number | null = null;

  /** Signals to the viewer that this source owns the playhead while playing. */
  readonly drivesPlayhead = true;

  constructor(readonly item: ReviewItem) {
    this.width = item.width;
    this.height = item.height;
    this.frameCount = Math.max(1, item.frameCount);

    const v = document.createElement("video");
    v.src = item.url;
    /*
     * `metadata`, not `auto`.
     *
     * `auto` invites the browser to fetch the whole clip before anyone has
     * asked to play it. On a lecture-length proxy that is ~150 MB pulled over
     * the studio link to show one frame, and it competes with the very range
     * requests that seeking needs — the difference between a frame in a second
     * and a black rectangle for a minute. Review seeks far more than it plays,
     * so take the metadata now and let playback and seeking pull what they
     * actually need.
     */
    v.preload = "metadata";
    v.playsInline = true;
    v.crossOrigin = "anonymous";
    // Only one host in the room should make noise; the viewer un-mutes the
    // designated audio owner explicitly.
    v.muted = true;
    v.loop = false;
    this.video = v;

    v.addEventListener("seeked", () => {
      this.seekPending = false;
      this.version++;
      this.emit();
      if (this.queuedSeek !== null) {
        const next = this.queuedSeek;
        this.queuedSeek = null;
        this.seekToFrame(next);
      }
    });
    v.addEventListener("error", () => {
      this.error = v.error ? `video error ${v.error.code}` : "video failed to load";
      this.emit();
    });
  }

  get element(): HTMLVideoElement {
    return this.video;
  }

  private get fps(): number {
    return this.item.fps && this.item.fps > 0 ? this.item.fps : 24;
  }

  ready(): Promise<void> {
    if (!this.loadedPromise) {
      this.loadedPromise = new Promise<void>((resolve, reject) => {
        if (this.video.readyState >= 2) return resolve();
        const ok = () => {
          cleanup();
          resolve();
        };
        const bad = () => {
          cleanup();
          reject(new Error(this.error ?? "video failed to load"));
        };
        const cleanup = () => {
          this.video.removeEventListener("loadeddata", ok);
          this.video.removeEventListener("error", bad);
        };
        this.video.addEventListener("loadeddata", ok);
        this.video.addEventListener("error", bad);
        /*
         * Setting `src` in the constructor already started this load. Calling
         * load() again does not nudge it along — it resets the element,
         * abandons whatever has been fetched and issues the request a second
         * time, so the opening of the clip is downloaded twice before the
         * first frame can appear. Only (re)start when there is nothing in
         * flight, which is the case after dispose() clears the src.
         */
        if (!this.video.currentSrc && !this.video.getAttribute("src")) this.video.load();
      });
    }
    return this.loadedPromise;
  }

  /** Frame currently presented by the element. */
  currentFrame(): number {
    const f = Math.round(this.video.currentTime * this.fps);
    return Math.min(this.frameCount - 1, Math.max(0, f));
  }

  setTransport(playing: boolean, rate: number, loop: LoopMode): void {
    const canPlayNatively = playing && rate > 0 && loop !== "bounce";
    if (canPlayNatively) {
      this.video.playbackRate = Math.min(8, Math.max(0.1, rate));
      this.video.loop = loop === "loop";
      if (!this.nativePlayback) {
        this.nativePlayback = true;
        void this.video.play().catch(() => {
          // Autoplay policy can refuse; fall back to seek-driven playback.
          this.nativePlayback = false;
        });
        this.startRvfc();
      }
    } else if (this.nativePlayback) {
      this.nativePlayback = false;
      this.video.pause();
      this.stopRvfc();
    }
  }

  get isPlayingNatively(): boolean {
    return this.nativePlayback && !this.video.paused;
  }

  private startRvfc(): void {
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
      cancelVideoFrameCallback?: (h: number) => void;
    };
    if (!v.requestVideoFrameCallback) return;
    const tick = () => {
      if (this.disposed || !this.nativePlayback) return;
      this.version++;
      this.emit();
      this.rvfcHandle = v.requestVideoFrameCallback!(tick);
    };
    this.rvfcHandle = v.requestVideoFrameCallback(tick);
  }

  private stopRvfc(): void {
    const v = this.video as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void };
    if (this.rvfcHandle !== null && v.cancelVideoFrameCallback) {
      v.cancelVideoFrameCallback(this.rvfcHandle);
    }
    this.rvfcHandle = null;
  }

  private seekToFrame(frame: number): void {
    if (this.seekPending) {
      // Coalesce: only the newest target matters when scrubbing.
      this.queuedSeek = frame;
      return;
    }
    this.lastSeekFrame = frame;
    this.seekPending = true;
    // Land mid-frame so rounding never picks the neighbour.
    this.video.currentTime = (frame + 0.5) / this.fps;
  }

  peek(frame: number): FrameRef | null {
    if (this.video.readyState < 2) {
      void this.ready().catch(() => {});
      return null;
    }
    if (!this.nativePlayback) {
      const target = Math.min(this.frameCount - 1, Math.max(0, Math.round(frame)));
      if (target !== this.lastSeekFrame) this.seekToFrame(target);
    }
    return {
      frame: this.currentFrame(),
      tex: { type: "video", video: this.video, width: this.width, height: this.height },
      exact: !this.seekPending,
      version: this.version,
    };
  }

  async request(frame: number): Promise<void> {
    await this.ready();
    this.seekToFrame(Math.min(this.frameCount - 1, Math.max(0, Math.round(frame))));
  }

  prefetch(): void {
    // The element manages its own buffering.
  }

  async fullRes(): Promise<TexSource | null> {
    return null; // the element is already at native resolution
  }

  stats(): CacheStats {
    const buffered: [number, number][] = [];
    try {
      for (let i = 0; i < this.video.buffered.length; i++) {
        buffered.push([
          Math.floor(this.video.buffered.start(i) * this.fps),
          Math.floor(this.video.buffered.end(i) * this.fps),
        ]);
      }
    } catch {
      // buffered can throw before metadata lands
    }
    const cached = buffered.reduce((n, [a, b]) => n + (b - a), 0);
    return {
      cached,
      total: this.frameCount,
      mode: "stream",
      bytes: 0,
      ranges: buffered,
      decoding: this.seekPending,
      error: this.error,
    };
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  setMuted(muted: boolean): void {
    this.video.muted = muted;
  }

  dispose(): void {
    this.disposed = true;
    this.stopRvfc();
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.listeners.clear();
  }
}
