import type { CacheStats, FrameRef, FrameSource, TexSource } from "./types";
import type { ReviewItem } from "../core/types";
import { rgbeToHalfFloat, RGBE_TRANSFER } from "../core/rgbe";
import { sharedLedger } from "./ledger";

/**
 * Shared base for sources whose frames are independently addressable images:
 * stills (1 frame), PDF pages, and image sequences.
 *
 * Holds an LRU of ImageBitmaps and fills around the playhead. Subclasses only
 * supply `load(frame)`.
 */
export abstract class BitmapCacheSource implements FrameSource {
  protected cache = new Map<number, ImageBitmap>();
  /**
   * Decoded half-float for HDR items, kept beside the bitmap because peek()
   * runs every frame and the RGBE unpack is a per-pixel loop — doing it on
   * demand would redo two million iterations per repaint.
   */
  protected hdrCache = new Map<number, TexSource>();
  protected inflight = new Map<number, Promise<void>>();
  protected listeners = new Set<() => void>();
  protected disposed = false;
  protected error: string | undefined;
  protected version = 0;
  /** Bytes this source currently holds against the shared ledger. */
  protected reserved = 0;
  /** Where the playhead was last seen, so trimming keeps the useful frames. */
  protected lastFrame = 0;
  private offLedger: (() => void) | null = null;
  private trimming = false;
  protected readyPromise: Promise<void> | null = null;

  /** Frames to keep resident. Overridden per source kind. */
  protected limit = 24;

  constructor(
    readonly item: ReviewItem,
    readonly width: number,
    readonly height: number,
    readonly frameCount: number,
  ) {
    // Lowering the ceiling has to actually hand memory back. Without this the
    // limit changed and nothing else did: frames already resident stayed
    // resident, and a paused viewer would sit over its new budget indefinitely
    // because the only thing that ever evicted was a *new* frame arriving.
    this.offLedger = sharedLedger().onChange(() => this.trim());
  }

  /**
   * Drop frames until the source is back inside the shared ceiling.
   *
   * Re-entrant by nature — each release emits the very change that triggered
   * this — so the guard is not optional. Three frames stay whatever happens,
   * for the same reason eviction keeps three: a cache trimmed to the playhead
   * makes every step a fresh decode.
   */
  protected trim(): void {
    if (this.trimming || this.disposed) return;
    this.trimming = true;
    let dropped = 0;
    try {
      while (sharedLedger().pressure > 1 && this.cache.size > 3) {
        if (!this.dropFurthest(this.lastFrame)) break;
        dropped++;
      }
    } finally {
      this.trimming = false;
    }
    if (dropped > 0) this.emit();
  }

  protected abstract load(frame: number): Promise<ImageBitmap>;

  /** True when this item's pixels are RGBE-packed and need unpacking. */
  protected get isHdr(): boolean {
    return this.item.colorSpace?.transfer === RGBE_TRANSFER;
  }

  /** The texture for a decoded frame — unpacked first if the item is HDR. */
  protected texFor(frame: number, bmp: ImageBitmap): TexSource {
    if (!this.isHdr) {
      return { type: "bitmap", bitmap: bmp, width: bmp.width, height: bmp.height };
    }
    let tex = this.hdrCache.get(frame);
    if (!tex) {
      tex = halfFloatOf(bmp);
      this.hdrCache.set(frame, tex);
    }
    return tex;
  }

  protected async init(): Promise<void> {}

  ready(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.init().catch((e) => {
        this.error = e instanceof Error ? e.message : String(e);
        console.warn(`art-review: ${this.item.label} failed to open`, e);
        this.emit();
      });
    }
    return this.readyPromise;
  }

  peek(frame: number): FrameRef | null {
    const clamped = Math.min(this.frameCount - 1, Math.max(0, Math.round(frame)));
    this.lastFrame = clamped;
    const hit = this.cache.get(clamped);
    if (hit) {
      this.touch(clamped);
      return {
        frame: clamped,
        tex: this.texFor(clamped, hit),
        exact: true,
        version: this.version,
      };
    }
    void this.request(clamped);

    // Nearest resident frame keeps something on screen while decoding rather
    // than flashing to black — important when scrubbing a long PDF.
    let best: number | null = null;
    for (const k of this.cache.keys()) {
      if (best === null || Math.abs(k - clamped) < Math.abs(best - clamped)) best = k;
    }
    if (best === null) return null;
    const bmp = this.cache.get(best)!;
    return {
      frame: best,
      tex: this.texFor(best, bmp),
      exact: false,
      version: this.version,
    };
  }

  async request(frame: number): Promise<void> {
    const f = Math.min(this.frameCount - 1, Math.max(0, Math.round(frame)));
    if (this.disposed || this.cache.has(f)) return;
    const existing = this.inflight.get(f);
    if (existing) return existing;

    const p = (async () => {
      try {
        await this.ready();
        const bmp = await this.load(f);
        if (this.disposed) {
          bmp.close?.();
          return;
        }
        // A frame that finished decoding further from the playhead than
        // anything already resident has arrived too late to be worth a slot:
        // taking one means evicting a nearer frame, which prefetch asks for
        // again on the next tick. That swap, repeating, is most of what makes
        // a stopped playhead's cached region creep.
        if (
          this.cache.size >= this.windowLimit &&
          Math.abs(f - this.lastFrame) > this.furthestDistance(this.lastFrame)
        ) {
          bmp.close?.();
          return;
        }

        // Anchored on the playhead, not on the frame that just arrived.
        // Evicting furthest-from-f lets a frame landing at the edge of the
        // window throw out one nearer the middle, which prefetch then asks for
        // again — the resident set shuffles instead of settling.
        this.reserveFor(this.lastFrame);
        this.cache.set(f, bmp);
        this.evict(this.lastFrame);
        this.version++;
        this.emit();
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
        // Surface it: a silently swallowed decode error shows up as a blank
        // stage with no clue why.
        console.warn(`art-review: frame ${f} of ${this.item.label} failed`, e);
        this.emit();
      } finally {
        this.inflight.delete(f);
      }
    })();

    this.inflight.set(f, p);
    return p;
  }

  prefetch(center: number, radius: number): void {
    // A window of N frames centred on the playhead reaches (N-1)/2 either side.
    // Halving N asks for N+1 frames, one more than can ever be held — so the
    // odd frame out was evicted on arrival and requested again immediately,
    // for ever. That is the wobble either side of a stopped playhead.
    const r = Math.min(radius, Math.max(1, Math.floor((this.windowLimit - 1) / 2)));
    for (let d = 0; d <= r; d++) {
      for (const f of d === 0 ? [center] : [center + d, center - d]) {
        if (f >= 0 && f < this.frameCount && !this.cache.has(f) && this.inflight.size < 4) {
          void this.request(f);
        }
      }
    }
  }

  /**
   * Bytes one resident frame costs.
   *
   * An HDR frame is held twice over — the RGBE bitmap and the half-float
   * unpacked from it — which is 28 MB at 2048×1152 against 8 MB for an
   * ordinary frame. A window sized for stills is a gigabyte here, so this is
   * what the memory bound is actually computed from.
   */
  protected get bytesPerFrame(): number {
    return this.width * this.height * (this.isHdr ? 12 : 4);
  }

  /**
   * The window that actually fits *this* source, as a frame count.
   *
   * `limit` alone describes a window nobody can pay for once frames get large:
   * prefetch would keep asking for 24 frames while memory allows 20, evict one
   * to make room for each new arrival, and re-decode the evicted one on the
   * next pass — a viewer sitting idle would decode for ever.
   *
   * The whole ceiling is not the answer either, because the other sources are
   * spending from it too. What is left is the ceiling minus everyone else's
   * usage, which is total usage less our own. Planning against the full
   * ceiling while a video holds a third of it produces the same thrash in a
   * quieter form: a resident set that creeps a frame either side of the
   * playhead for ever without settling.
   */
  protected get windowLimit(): number {
    const ledger = sharedLedger();
    const others = Math.max(0, ledger.bytesUsed - this.reserved);
    const mine = Math.max(0, ledger.bytesLimit - others);
    const room = Math.floor(mine / Math.max(1, this.bytesPerFrame));
    return Math.max(3, Math.min(this.limit, room));
  }

  /**
   * Room for one more frame, evicting until the tab-wide ledger grants it.
   *
   * The ledger is shared with every other source on purpose: a per-source
   * allowance is not a budget, because prefetching N items then holds N × it.
   * Three frames stay resident whatever the pressure — evicting down to the
   * playhead makes every step a fresh decode, which is worse than overshooting.
   */
  protected reserveFor(near: number): void {
    const per = this.bytesPerFrame;
    while (!sharedLedger().reserve(per)) {
      if (this.cache.size <= 3 || !this.dropFurthest(near)) return;
    }
    this.reserved += per;
  }

  /** Keep the LRU bounded, preferring to drop frames far from `near`. */
  protected evict(near: number): void {
    while (this.cache.size > this.windowLimit) {
      if (!this.dropFurthest(near)) break;
    }
  }

  /** How far from `near` the most distant resident frame sits. -1 if empty. */
  protected furthestDistance(near: number): number {
    let worst = -1;
    for (const k of this.cache.keys()) worst = Math.max(worst, Math.abs(k - near));
    return worst;
  }

  /** Drop the resident frame furthest from `near`. False if none can go. */
  protected dropFurthest(near: number): boolean {
    let worst: number | null = null;
    for (const k of this.cache.keys()) {
      if (worst === null || Math.abs(k - near) > Math.abs(worst - near)) worst = k;
    }
    if (worst === null || worst === near) return false;
    this.cache.get(worst)?.close?.();
    this.cache.delete(worst);
    this.hdrCache.delete(worst);
    this.releaseOne();
    return true;
  }

  private releaseOne(): void {
    const per = Math.min(this.bytesPerFrame, this.reserved);
    sharedLedger().release(per);
    this.reserved -= per;
  }

  protected touch(_frame: number): void {
    // Distance-based eviction; nothing to record.
  }

  stats(): CacheStats {
    const keys = [...this.cache.keys()].sort((a, b) => a - b);
    const ranges: [number, number][] = [];
    for (const k of keys) {
      const last = ranges[ranges.length - 1];
      if (last && k === last[1] + 1) last[1] = k;
      else ranges.push([k, k]);
    }
    // HDR frames are held twice over: the source bitmap and the unpacked
    // half-float, at 4 and 8 bytes a pixel.
    const perPixel = this.isHdr ? 12 : 4;
    let bytes = 0;
    for (const b of this.cache.values()) bytes += b.width * b.height * perPixel;
    return {
      cached: this.cache.size,
      total: this.frameCount,
      mode: this.cache.size >= this.frameCount ? "full" : "window",
      bytes,
      ranges,
      decoding: this.inflight.size > 0,
      error: this.error,
    };
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  protected emit(): void {
    for (const l of this.listeners) l();
  }

  dispose(): void {
    this.disposed = true;
    this.offLedger?.();
    this.offLedger = null;
    // Give the ledger back everything at once — releasing per frame as the map
    // drains would leave a source that died mid-decode holding the difference,
    // and nothing else can ever hand it back.
    sharedLedger().release(this.reserved);
    this.reserved = 0;
    for (const b of this.cache.values()) b.close?.();
    this.cache.clear();
    this.hdrCache.clear();
    this.inflight.clear();
    this.listeners.clear();
  }
}

/** Decode an image URL without letting the browser silently convert colour. */
export async function loadBitmap(url: string, maxWidth?: number): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} loading ${url}`);
  const blob = await res.blob();
  const opts: ImageBitmapOptions = { colorSpaceConversion: "none", premultiplyAlpha: "none" };
  if (maxWidth) {
    const probe = await createImageBitmap(blob, opts);
    if (probe.width <= maxWidth) return probe;
    const scale = maxWidth / probe.width;
    const scaled = await createImageBitmap(probe, {
      ...opts,
      resizeWidth: Math.round(probe.width * scale),
      resizeHeight: Math.round(probe.height * scale),
      resizeQuality: "high",
    });
    probe.close();
    return scaled;
  }
  return createImageBitmap(blob, opts);
}

export function texOf(bitmap: ImageBitmap): TexSource {
  return { type: "bitmap", bitmap, width: bitmap.width, height: bitmap.height };
}

/**
 * Read an RGBE PNG back to linear half-float.
 *
 * The bytes have to be got at unchanged, so this goes through a canvas rather
 * than straight to a texture: `willReadFrequently` keeps it on the CPU side,
 * and the bitmap was decoded with `colorSpaceConversion: "none"` so nothing has
 * quietly reinterpreted the exponent channel as colour on the way in.
 */
export function halfFloatOf(bitmap: ImageBitmap): TexSource {
  const { width, height } = bitmap;
  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement("canvas"), { width, height });
  const ctx = (canvas as OffscreenCanvas).getContext("2d", {
    willReadFrequently: true,
    colorSpace: "srgb",
  }) as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error("no 2d context to decode RGBE");
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);
  return {
    type: "half",
    data: rgbeToHalfFloat(new Uint8Array(data.buffer, data.byteOffset, data.length), width * height),
    width,
    height,
  };
}
