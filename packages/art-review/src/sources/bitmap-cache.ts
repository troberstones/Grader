import type { CacheStats, FrameRef, FrameSource, TexSource } from "./types";
import type { ReviewItem } from "../core/types";
import { rgbeToHalfFloat, RGBE_TRANSFER } from "../core/rgbe";

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
  protected readyPromise: Promise<void> | null = null;

  /** Frames to keep resident. Overridden per source kind. */
  protected limit = 24;

  constructor(
    readonly item: ReviewItem,
    readonly width: number,
    readonly height: number,
    readonly frameCount: number,
  ) {}

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
        this.cache.set(f, bmp);
        this.evict(f);
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
    const r = Math.min(radius, Math.max(1, Math.floor(this.limit / 2)));
    for (let d = 0; d <= r; d++) {
      for (const f of d === 0 ? [center] : [center + d, center - d]) {
        if (f >= 0 && f < this.frameCount && !this.cache.has(f) && this.inflight.size < 4) {
          void this.request(f);
        }
      }
    }
  }

  /** Keep the LRU bounded, preferring to drop frames far from `near`. */
  protected evict(near: number): void {
    while (this.cache.size > this.limit) {
      let worst: number | null = null;
      for (const k of this.cache.keys()) {
        if (worst === null || Math.abs(k - near) > Math.abs(worst - near)) worst = k;
      }
      if (worst === null || worst === near) break;
      this.cache.get(worst)?.close?.();
      this.cache.delete(worst);
      this.hdrCache.delete(worst);
    }
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
