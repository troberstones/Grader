import { chooseCacheSize, frameBytes, suitsFrameCache, type Budget } from "../core/budget";
import { sharedLedger } from "./ledger";
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
 * The video branch is the interesting one. WebCodecs gets a clip short enough
 * to be worth decoding whole (see suitsFrameCache); everything else — a long
 * clip, or a browser without WebCodecs — streams through `<video>`. Both
 * satisfy the same interface, so nothing above this call knows which it got.
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
      if (
        !opts.forceElementVideo &&
        DecodedVideoSource.supported &&
        item.frameCount > 1 &&
        suitsFrameCache(item)
      ) {
        const tooBig = handPickedTooBig(item, ctx, budget);
        if (tooBig) return new VideoElementSource(item, tooBig);
        return new DecodedVideoSource(item, ctx, budget);
      }
      return new VideoElementSource(item, streamingReason(item, opts));
    case "still":
    default:
      return new StillSource(item, ctx);
  }
}

/**
 * Why a video is streaming through `<video>` instead of being decoded into the
 * frame cache — shown as a tooltip on the timeline, because the two reasons
 * want different things from the person running the review. A long clip is
 * working as designed; a browser without WebCodecs means every clip in the
 * course is streaming, and on a self-hosted install that is nearly always the
 * page being served over HTTP, where the API is withheld from insecure
 * contexts. Serving the same app over HTTPS turns it on with no other change.
 */
function streamingReason(
  item: ReviewItem,
  opts: { forceElementVideo?: boolean },
): string | undefined {
  if (item.frameCount <= 1) return undefined; // a one-frame "video" is a still
  if (opts.forceElementVideo) return "frame cache turned off for this session";
  if (!DecodedVideoSource.supported) {
    return typeof isSecureContext !== "undefined" && !isSecureContext
      ? "no frame cache: WebCodecs needs a secure context — open this over HTTPS"
      : "no frame cache: this browser has no WebCodecs";
  }
  return "clip too long to cache; streaming it instead";
}

/**
 * A resolution picked by hand is a promise about what is on screen, so when
 * the whole clip will not fit the cache at that size it streams at native
 * resolution instead — never quietly cached smaller, which is the behaviour
 * picking one is meant to get away from. The note says which way to move.
 */
function handPickedTooBig(item: ReviewItem, ctx: SourceContext, budget: Budget): string | undefined {
  const quality = ctx.videoQuality ?? "auto";
  if (quality === "auto") return undefined;
  const ceiling = sharedLedger().bytesLimit;
  const choice = chooseCacheSize({ ...budget, ram: ceiling }, item.width, item.height, item.frameCount, ctx.viewportWidth, quality);
  if (choice.fitsWholeClip) return undefined;
  const need = Math.ceil((frameBytes(choice.width, choice.height) * item.frameCount) / (1024 * 1024));
  return `streaming: ${choice.width}×${choice.height} needs ${need} MB to cache, over the ${Math.round(ceiling / (1024 * 1024))} MB ceiling — raise the cache or pick a lower resolution`;
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
    return new VideoElementSource(item, "decoding this clip failed; streaming it instead");
  }
}
