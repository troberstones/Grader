import type { LayerInfo, LayerManifest, ReviewItem } from "../core/types";

/**
 * Anything the renderer can turn into a texture.
 *
 * `pixels` exists so the decoded-video path can hold frames as plain
 * Uint8Arrays in system RAM (L2). ImageBitmap may be GPU-backed depending on
 * the browser, which would put those frames straight back under the GPU cap we
 * are trying to stay beneath.
 */
export type TexSource =
  | { type: "bitmap"; bitmap: ImageBitmap; width: number; height: number }
  | { type: "video"; video: HTMLVideoElement; width: number; height: number }
  | { type: "pixels"; data: Uint8Array; width: number; height: number; channels: 3 | 4 };

export interface FrameRef {
  /** The frame actually available — may lag the request while decoding. */
  frame: number;
  tex: TexSource;
  /** False when this is a stand-in for a frame still being decoded. */
  exact: boolean;
  /** Bumped whenever the underlying pixels change (video element playback). */
  version: number;
}

export type CacheMode = "full" | "window" | "stream" | "n/a";

export interface CacheStats {
  cached: number;
  total: number;
  mode: CacheMode;
  bytes: number;
  /** Ranges of frames currently resident, for the timeline fill indicator. */
  ranges: [number, number][];
  decoding: boolean;
  error?: string;
}

export interface FrameSource {
  readonly item: ReviewItem;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;

  ready(): Promise<void>;

  /**
   * Synchronous best-effort lookup. The render loop calls this every frame and
   * must never await, so a miss returns the nearest resident frame (or null)
   * and schedules a fill.
   */
  peek(frame: number): FrameRef | null;

  /** Ask for a frame; resolves when it is resident (or immediately if it is). */
  request(frame: number): Promise<void>;

  /** Hint the cache to fill around a frame. */
  prefetch(center: number, radius: number): void;

  stats(): CacheStats;

  /** Fires when new frames land, so the render loop knows to redraw. */
  onChange(cb: () => void): () => void;

  /**
   * Full-resolution decode of a single frame, for zooming past the cache
   * resolution while paused. Optional — sources that always cache natively
   * return null.
   */
  fullRes?(frame: number): Promise<TexSource | null>;

  dispose(): void;
}

/** PSD sources add a layer stack on top of the frame interface. */
export interface LayeredFrameSource extends FrameSource {
  manifest(): LayerManifest | null;
  /** Textures for the currently visible layers, bottom to top. */
  layerStack(visible: Record<string, boolean>, solo: string | null): LayerDraw[];
  requestLayer(id: string): void;
}

export interface LayerDraw {
  layer: LayerInfo;
  tex: TexSource;
  /** Destination rect in media pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SourceContext {
  /** Budget-derived ceiling for cached frame width. */
  maxCacheWidth: number;
  /** Bytes available for this source's L2 cache. */
  ramBudget: number;
  /** Viewport width in device pixels, for choosing cache resolution. */
  viewportWidth: number;
  /** Where the pdf.js worker lives. */
  pdfWorkerUrl: string;
}

export const DEFAULT_SOURCE_CONTEXT: SourceContext = {
  maxCacheWidth: 1920,
  ramBudget: 1024 * 1024 * 1024,
  viewportWidth: 1600,
  pdfWorkerUrl: "/pdf.worker.min.mjs",
};

export type { ReviewItem };
