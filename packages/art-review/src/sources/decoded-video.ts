/// <reference path="./mp4box.d.ts" />
import { chooseCacheSize, type Budget } from "../core/budget";
import type { ReviewItem } from "../core/types";
import { MemoryLedger, sharedLedger } from "./ledger";
import type { CacheStats, FrameRef, FrameSource, SourceContext, TexSource } from "./types";

/**
 * The flipbook path: demux with mp4box, decode with WebCodecs, keep frames as
 * plain RGBA buffers in system RAM (L2). The renderer owns the texture tier.
 *
 * Why raw buffers rather than ImageBitmaps: ImageBitmap may be GPU-backed
 * depending on the browser, which puts the cache straight back under the GPU
 * memory cap. Uint8Array is unambiguously system RAM.
 *
 * Why this exists at all: `<video>` cannot play backwards and cannot seek to an
 * exact frame. Decoding up front makes bounce, scrub and frame-stepping all
 * trivial and identical to an image sequence.
 */

const CHANNELS = 4; // VideoFrame.copyTo gives RGBA; see frameBytes()

export interface DecodeProgress {
  decoded: number;
  total: number;
  done: boolean;
}

export class DecodedVideoSource implements FrameSource {
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;

  /** Cache resolution — may be below native when the budget demands it. */
  readonly cacheWidth: number;
  readonly cacheHeight: number;

  private frames = new Map<number, Uint8Array>();
  private listeners = new Set<() => void>();
  private version = 0;
  private disposed = false;
  private error: string | undefined;
  private decodedCount = 0;
  private decoding = false;
  private startPromise: Promise<void> | null = null;
  private fitsWholeClip: boolean;
  private windowCenter = 0;
  private scratch: OffscreenCanvas | null = null;

  private ledger: MemoryLedger;

  constructor(
    readonly item: ReviewItem,
    private ctx: SourceContext,
    private budget: Budget,
    ledger?: MemoryLedger,
  ) {
    this.width = item.width;
    this.height = item.height;
    this.frameCount = Math.max(1, item.frameCount);
    this.ledger = ledger ?? sharedLedger(budget.ram);

    const choice = chooseCacheSize(
      budget,
      item.width,
      item.height,
      this.frameCount,
      ctx.viewportWidth,
    );
    this.cacheWidth = choice.width;
    this.cacheHeight = choice.height;
    this.fitsWholeClip = choice.fitsWholeClip;
  }

  static get supported(): boolean {
    return (
      typeof globalThis !== "undefined" &&
      typeof (globalThis as { VideoDecoder?: unknown }).VideoDecoder === "function" &&
      typeof OffscreenCanvas === "function"
    );
  }

  ready(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.run().catch((e) => {
        this.error = e instanceof Error ? e.message : String(e);
        this.decoding = false;
        this.emit();
        throw e;
      });
    }
    return this.startPromise;
  }

  /**
   * Fetch → demux → decode. Frames stream into the cache as they arrive, so the
   * viewer is interactive long before the clip finishes caching.
   */
  private async run(): Promise<void> {
    this.decoding = true;
    this.emit();

    const [mp4box, buffer] = await Promise.all([
      import("mp4box"),
      fetch(this.item.url).then((r) => {
        if (!r.ok) throw new Error(`${r.status} fetching video`);
        return r.arrayBuffer();
      }),
    ]);

    const file = mp4box.createFile();
    const info = await new Promise<import("mp4box").MP4Info>((resolve, reject) => {
      file.onReady = resolve;
      file.onError = (e) => reject(new Error(`mp4box: ${e}`));
      const buf = buffer as import("mp4box").MP4ArrayBuffer;
      buf.fileStart = 0;
      file.appendBuffer(buf);
      file.flush();
    });

    const track = info.videoTracks?.[0];
    if (!track) throw new Error("no video track");

    const description = extractDescription(file, track.id, mp4box.DataStream);
    const config: VideoDecoderConfig = {
      codec: track.codec,
      codedWidth: track.video.width,
      codedHeight: track.video.height,
      hardwareAcceleration: "prefer-hardware",
      optimizeForLatency: false,
    };
    if (description) config.description = description;

    const support = await VideoDecoder.isConfigSupported(config);
    if (!support.supported) throw new Error(`codec not supported: ${track.codec}`);

    // Collect samples first: mp4box hands them over synchronously and the
    // decoder queue must not outrun its output pool.
    const samples: import("mp4box").MP4Sample[] = [];
    file.onSamples = (_id, _user, batch) => {
      for (const s of batch) samples.push(s);
    };
    file.setExtractionOptions(track.id, null, { nbSamples: Number.MAX_SAFE_INTEGER });
    file.start();
    file.flush();
    file.stop();

    if (samples.length === 0) throw new Error("no samples extracted");

    let index = 0;
    const decoder = new VideoDecoder({
      output: (frame) => {
        const i = index++;
        try {
          if (!this.disposed && this.wants(i)) void this.store(i, frame);
          else frame.close();
        } catch {
          frame.close();
        }
        this.decodedCount = Math.max(this.decodedCount, index);
      },
      error: (e) => {
        this.error = e.message;
        this.decoding = false;
        this.emit();
      },
    });
    decoder.configure(config);

    for (const s of samples) {
      if (this.disposed) break;
      decoder.decode(
        new EncodedVideoChunk({
          type: s.is_sync ? "key" : "delta",
          timestamp: (s.cts * 1_000_000) / s.timescale,
          duration: (s.duration * 1_000_000) / s.timescale,
          data: s.data,
        }),
      );
      // Keep the decoder's output pool from filling: it stops emitting if too
      // many frames are outstanding, which reads as a silent hang.
      if (decoder.decodeQueueSize > 24) {
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    }

    await decoder.flush().catch(() => {});
    decoder.close();

    // Drop the demuxed samples and the source buffer — together they are the
    // size of the whole proxy file and nothing needs them once decoded.
    samples.length = 0;
    file.stop();

    this.decoding = false;
    this.emit();
  }

  /** Under a window budget, only keep frames near the playhead. */
  private wants(frame: number): boolean {
    if (this.fitsWholeClip) return true;
    const radius = Math.max(60, Math.floor(this.budget.l1Frames / 2));
    return Math.abs(frame - this.windowCenter) <= radius;
  }

  private get bytesPerFrame(): number {
    return this.cacheWidth * this.cacheHeight * CHANNELS;
  }

  private async store(index: number, frame: VideoFrame): Promise<void> {
    try {
      if (this.disposed || this.frames.has(index)) return;

      // Reserve before decoding into a buffer, and make room by evicting the
      // frames furthest from the playhead rather than allocating past the cap.
      const size = this.bytesPerFrame;
      if (!this.ledger.reserve(size)) {
        this.evictFurthest(index, size);
        if (!this.ledger.reserve(size)) {
          // Genuinely full: this clip runs as a sliding window from here.
          this.fitsWholeClip = false;
          return;
        }
      }

      let data: Uint8Array;
      try {
        data = await this.toRgba(frame);
      } catch (e) {
        this.ledger.release(size);
        throw e;
      }
      if (this.disposed) {
        this.ledger.release(size);
        return;
      }

      this.frames.set(index, data);
      this.version++;
      this.emit();
    } finally {
      // Non-negotiable: an unclosed VideoFrame starves the decoder's pool and
      // decoding stops dead with no error.
      frame.close();
    }
  }

  /** Drop frames furthest from the playhead until `needed` bytes are free. */
  private evictFurthest(near: number, needed: number): void {
    const size = this.bytesPerFrame;
    let freed = 0;
    while (freed < needed && this.frames.size > 1) {
      let worst: number | null = null;
      for (const k of this.frames.keys()) {
        if (k === near) continue;
        if (worst === null || Math.abs(k - this.windowCenter) > Math.abs(worst - this.windowCenter)) {
          worst = k;
        }
      }
      if (worst === null) break;
      // Never evict what is about to be shown.
      if (Math.abs(worst - this.windowCenter) <= 2) break;
      this.frames.delete(worst);
      this.ledger.release(size);
      freed += size;
    }
  }

  /**
   * copyTo with an explicit RGBA format is the fast path, but format conversion
   * is not universally implemented — fall back to a canvas readback, which is
   * slower but works everywhere.
   */
  private async toRgba(frame: VideoFrame): Promise<Uint8Array> {
    const w = this.cacheWidth;
    const h = this.cacheHeight;
    const nativeSize = frame.displayWidth === w && frame.displayHeight === h;

    if (nativeSize) {
      try {
        const size = frame.allocationSize({ format: "RGBA" });
        const buf = new Uint8Array(size);
        await frame.copyTo(buf, { format: "RGBA" });
        return buf;
      } catch {
        // fall through to canvas
      }
    }

    if (!this.scratch) this.scratch = new OffscreenCanvas(w, h);
    const canvas = this.scratch;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (!g) throw new Error("no 2d context for frame readback");
    g.clearRect(0, 0, w, h);
    g.drawImage(frame, 0, 0, w, h);
    return new Uint8Array(g.getImageData(0, 0, w, h).data.buffer);
  }

  /** Release everything this source holds back to the ledger. */
  private releaseAll(): void {
    this.ledger.release(this.frames.size * this.bytesPerFrame);
    this.frames.clear();
  }

  peek(frame: number): FrameRef | null {
    const f = Math.min(this.frameCount - 1, Math.max(0, Math.round(frame)));
    this.windowCenter = f;
    const hit = this.frames.get(f);
    if (hit) {
      return {
        frame: f,
        tex: {
          type: "pixels",
          data: hit,
          width: this.cacheWidth,
          height: this.cacheHeight,
          channels: CHANNELS,
        },
        exact: true,
        version: this.version,
      };
    }
    // Nearest resident frame — better than a black flash while the cache fills.
    let best: number | null = null;
    for (const k of this.frames.keys()) {
      if (best === null || Math.abs(k - f) < Math.abs(best - f)) best = k;
    }
    if (best === null) return null;
    const data = this.frames.get(best)!;
    return {
      frame: best,
      tex: {
        type: "pixels",
        data,
        width: this.cacheWidth,
        height: this.cacheHeight,
        channels: CHANNELS,
      },
      exact: false,
      version: this.version,
    };
  }

  async request(frame: number): Promise<void> {
    this.windowCenter = frame;
    await this.ready();
  }

  prefetch(center: number): void {
    this.windowCenter = center;
  }

  async fullRes(): Promise<TexSource | null> {
    return null;
  }

  stats(): CacheStats {
    const keys = [...this.frames.keys()].sort((a, b) => a - b);
    const ranges: [number, number][] = [];
    for (const k of keys) {
      const last = ranges[ranges.length - 1];
      if (last && k === last[1] + 1) last[1] = k;
      else ranges.push([k, k]);
    }
    return {
      cached: this.frames.size,
      total: this.frameCount,
      mode: this.fitsWholeClip ? "full" : "window",
      bytes: this.frames.size * this.cacheWidth * this.cacheHeight * CHANNELS,
      ranges,
      decoding: this.decoding,
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

  dispose(): void {
    this.disposed = true;
    this.releaseAll();
    this.listeners.clear();
    this.scratch = null;
  }
}

/**
 * Dig the avcC/hvcC/vpcC/av1C box out of the sample description — VideoDecoder
 * needs it as `config.description` for AVC/HEVC in mp4 (parameter sets live in
 * the container, not the bitstream). Codecs that carry them in-band need none,
 * so a miss here is not an error.
 */
function extractDescription(
  file: import("mp4box").MP4File,
  trackId: number,
  DataStream: typeof import("mp4box").DataStream,
): Uint8Array | undefined {
  try {
    const trak = file.getTrackById(trackId);
    for (const entry of trak.mdia.minf.stbl.stsd.entries) {
      const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
      if (!box) continue;
      const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
      box.write(stream);
      // Strip the 8-byte box header the writer prepends.
      return new Uint8Array(stream.buffer.slice(8));
    }
  } catch {
    // Malformed or unusual sample description — let the decoder try without.
  }
  return undefined;
}
