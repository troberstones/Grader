import type { Budget } from "../core/budget";
import type { ReviewItem } from "../core/types";
import { DecodedVideoSource } from "./decoded-video";
import { LayeredSource } from "./layered";
import { PageSource } from "./pages";
import { SequenceSource, StillSource } from "./still";
import type { FrameSource, SourceContext } from "./types";
import { VideoElementSource } from "./video-element";

export * from "./types";
export { StillSource, SequenceSource } from "./still";
export { PageSource } from "./pages";
export { LayeredSource } from "./layered";
export { VideoElementSource } from "./video-element";
export { DecodedVideoSource } from "./decoded-video";

/**
 * Pick an implementation for an item.
 *
 * The video branch is the interesting one: WebCodecs when available (Chrome,
 * Safari 16.4+, Firefox 130+), `<video>` otherwise. Both satisfy the same
 * interface, so nothing above this call knows which it got.
 */
export function createSource(
  item: ReviewItem,
  ctx: SourceContext,
  budget: Budget,
  opts: { forceElementVideo?: boolean } = {},
): FrameSource {
  switch (item.kind) {
    case "layered":
      return new LayeredSource(item, ctx);
    case "pages":
      // Pages pre-rasterised at ingest behave as a sequence; otherwise pdf.js.
      return item.frameUrls?.length
        ? new SequenceSource(item, ctx)
        : new PageSource(item, ctx);
    case "sequence":
      return new SequenceSource(item, ctx);
    case "video":
      if (!opts.forceElementVideo && DecodedVideoSource.supported && item.frameCount > 1) {
        return new DecodedVideoSource(item, ctx, budget);
      }
      return new VideoElementSource(item);
    case "still":
    default:
      return new StillSource(item, ctx);
  }
}

/**
 * Wrap a video source so a decode failure silently falls back to `<video>`.
 * Losing frame-exact scrub is much better than losing the review.
 */
export async function createSourceWithFallback(
  item: ReviewItem,
  ctx: SourceContext,
  budget: Budget,
  onFallback?: (reason: string) => void,
): Promise<FrameSource> {
  const primary = createSource(item, ctx, budget);
  if (!(primary instanceof DecodedVideoSource)) return primary;
  try {
    await primary.ready();
    return primary;
  } catch (e) {
    primary.dispose();
    onFallback?.(e instanceof Error ? e.message : String(e));
    return new VideoElementSource(item);
  }
}
