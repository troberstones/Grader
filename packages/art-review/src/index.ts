export { ArtReviewer, type ArtReviewerProps } from "./react/ArtReviewer";
export { useViewer } from "./react/useViewer";
export { useSession } from "./react/useSession";
export { useAnnotations } from "./react/useAnnotations";
export { Timeline } from "./react/components/Timeline";
export { Presence } from "./react/components/Presence";
export { LayerPanel } from "./react/components/LayerPanel";

export * from "./core/types";
export {
  encodeStroke,
  decodeStroke,
  toBase64,
  fromBase64,
  hexToRgba,
  rgbaToHex,
  rgbaToCss,
  simplify,
  Smoother,
} from "./core/strokes";
export { fold, step, prevMarker, nextMarker } from "./core/fold";
export { reduceViewer, initialStateFor } from "./core/reducer";
export {
  isBroadcast,
  shouldApply,
  TRANSPORT_ACTIONS,
  VIEW_ACTIONS,
  ALWAYS_ACTIONS,
  type Action,
  type Envelope,
  type WireStroke,
} from "./core/actions";
export { ClockSync, projectFrame, needsResync } from "./core/clock";
export { BUDGETS, detectBudget, chooseCacheSize, frameBytes, framesThatFit, type Budget } from "./core/budget";

export { GLRenderer, parseCubeLut, type ViewParams } from "./render/gl";
export * from "./render/overlay";

export { createSource, createSourceWithFallback } from "./sources";
export type { FrameSource, CacheStats, SourceContext, TexSource } from "./sources/types";

export type {
  ReviewChannel,
  ReviewDataAdapter,
  StoredStroke,
  StrokeInput,
} from "./adapter/types";
