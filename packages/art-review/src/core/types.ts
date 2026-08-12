/**
 * Core value types. No DOM, no React, no grader — this file must stay importable
 * from a plain node test.
 */

export type MediaKind = "still" | "pages" | "video" | "sequence" | "layered";

export type LoopMode = "off" | "loop" | "bounce";

export type Rotation = 0 | 90 | 180 | 270;

export type ViewTransform = "native" | "srgb" | "display-p3" | "rec709";

export type ChannelView = "rgb" | "r" | "g" | "b" | "a" | "luma";

export interface ColorSpaceInfo {
  /** Primaries name as reported by ffprobe / ICC, e.g. "bt709", "display-p3". */
  primaries?: string;
  transfer?: string;
  /** URL of an extracted ICC profile, if the source carried one. */
  iccUrl?: string;
}

/** One entry in the review playlist. */
export interface ReviewItem {
  id: string;
  label: string;
  kind: MediaKind;
  mime: string;
  /** Range-served URL of the primary media (proxy for video, PNG for stills). */
  url: string;
  width: number;
  height: number;
  /** 1 for stills, page count for pages, frame count for video/sequence. */
  frameCount: number;
  /** Authored fps; null for non-time-based media. */
  fps: number | null;
  duration: number | null;
  posterUrl?: string;
  /** Per-frame URLs for `pages` and `sequence`. */
  frameUrls?: string[];
  /** Layer manifest URL for `layered` (PSD). */
  layersUrl?: string;
  /** True when the video proxy was encoded all-intra (every frame a keyframe). */
  allIntra?: boolean;
  colorSpace?: ColorSpaceInfo;
  /**
   * Set when the file could not be processed at all (corrupt upload, codec we
   * cannot transcode). Carries the reason so the viewer can say what is wrong
   * rather than failing to decode it a second time in front of the user.
   */
  unavailable?: string;
}

/** A PSD layer, flattened into a list with depth for tree rendering. */
export interface LayerInfo {
  id: string;
  name: string;
  depth: number;
  /** Group nodes have no raster of their own until expanded. */
  isGroup: boolean;
  /** Parent group id, or null at the root. */
  parentId: string | null;
  visible: boolean;
  opacity: number;
  blendMode: string;
  /** Left, top, right, bottom in media pixels. */
  bounds: [number, number, number, number];
  clipping: boolean;
  /** Adjustment layers and smart filters are baked into the composite. */
  bakedIntoComposite: boolean;
  /** Set when the blend mode is not reproducible in the shader. */
  blendUnsupported: boolean;
  /** URL that renders this layer's raster on demand. */
  rasterUrl: string | null;
}

export interface LayerManifest {
  itemId: string;
  width: number;
  height: number;
  layers: LayerInfo[];
  /** True when the layer count / pixel budget forced composite-only mode. */
  compositeOnly: boolean;
  compositeUrl: string;
}

export interface ColorState {
  transform: ViewTransform;
  /** Exposure in stops. 0 = unchanged. */
  exposure: number;
  gamma: number;
  /** 1 = normal, 0 = fully desaturated ("value check"). */
  saturation: number;
  /** Squint-test blur radius in device pixels. 0 = off. */
  blur: number;
  channel: ChannelView;
  /** Identifier of a loaded .cube LUT, or null. */
  lut: string | null;
}

export type FitMode = "fit" | "fill" | "actual" | "free";

export type GuideKind = "none" | "thirds" | "golden" | "center" | "diagonals" | "grid";

export interface ViewerState {
  itemIndex: number;
  frame: number;
  playing: boolean;
  rate: number;
  loop: LoopMode;
  /** Display fps — may differ from the item's authored fps. */
  fps: number;
  flipH: boolean;
  flipV: boolean;
  rotate: Rotation;
  zoom: number;
  panX: number;
  panY: number;
  fit: FitMode;
  color: ColorState;
  /** Composition overlay. Viewer state, not tool state — the room shares it. */
  guides: GuideKind;
  /** PSD layer visibility overrides, keyed by layer id. */
  layers: Record<string, boolean>;
  soloLayer: string | null;
  /** Show the flattened composite rather than the live layer stack. */
  composite: boolean;
  /** Pause playback when a frame carrying annotations is reached. */
  pauseOnAnnotated: boolean;
  /** Ghost strokes fade out after this many ms. 0 = permanent. */
  ghostMs: number;
  onionSkin: number;
}

export const DEFAULT_COLOR_STATE: ColorState = {
  transform: "srgb",
  exposure: 0,
  gamma: 1,
  saturation: 1,
  blur: 0,
  channel: "rgb",
  lut: null,
};

export const DEFAULT_VIEWER_STATE: ViewerState = {
  itemIndex: 0,
  frame: 0,
  playing: false,
  rate: 1,
  loop: "loop",
  fps: 24,
  flipH: false,
  flipV: false,
  rotate: 0,
  zoom: 1,
  panX: 0,
  panY: 0,
  fit: "fit",
  color: DEFAULT_COLOR_STATE,
  guides: "none",
  layers: {},
  soloLayer: null,
  composite: true,
  pauseOnAnnotated: false,
  ghostMs: 0,
  onionSkin: 0,
};

// ── Annotation ────────────────────────────────────────────────────────────────

export type StrokeTool =
  | "pen"
  | "line"
  | "arrow"
  | "rect"
  | "ellipse"
  | "text"
  | "highlight"
  | "stamp";

export const STROKE_TOOLS: StrokeTool[] = [
  "pen",
  "line",
  "arrow",
  "rect",
  "ellipse",
  "text",
  "highlight",
  "stamp",
];

export interface Stroke {
  /** Server id; absent until committed. */
  id?: number;
  /** Monotonic per item; the sync cursor. */
  seq?: number;
  /** Client-generated id, stable across the in-progress → committed transition. */
  localId: string;
  tool: StrokeTool;
  /** Packed RGBA, 0xRRGGBBAA. */
  color: number;
  /**
   * Stroke width in "reference pixels" — pixels at a nominal 2000px-wide media.
   * Stored resolution-independently so a stroke drawn on the iPad has the same
   * visual weight on a 6000px scan.
   */
  width: number;
  frameIn: number;
  frameOut: number;
  authorId: string;
  /** Flat [x0,y0,x1,y1,…] normalised to 0..1 of media width/height. */
  points: number[];
  /** Per-point pressure 0..1, or undefined when the input had none. */
  pressure?: number[];
  /** Text payload for the `text` tool. */
  text?: string;
  filled?: boolean;
  /** Layer ids visible when this stroke was made (PSD layer-pinned notes). */
  layers?: string[];
  createdAt?: string;
}

export interface FrameMarker {
  frameIn: number;
  frameOut: number;
  count: number;
}

export interface Author {
  id: string;
  name: string;
  /** Packed RGBA used as this author's default ink. */
  color: number;
}

// ── Session / presence ────────────────────────────────────────────────────────

export type Role = "master" | "follower" | "free";

export interface Peer {
  clientId: string;
  name: string;
  role: Role;
  /** Round-trip time in ms, or null before the first ping completes. */
  rttMs: number | null;
  lastSeen: number;
}
