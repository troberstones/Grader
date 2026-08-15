import { BitmapCacheSource, loadBitmap } from "./bitmap-cache";
import type { SourceContext, TexSource } from "./types";
import type { ReviewItem } from "../core/types";

/** A single image: png, jpg, webp, or a server-flattened tiff/psd composite. */
export class StillSource extends BitmapCacheSource {
  protected limit = 1;
  private full: ImageBitmap | null = null;

  constructor(
    item: ReviewItem,
    private ctx: SourceContext,
  ) {
    super(item, item.width, item.height, 1);
  }

  protected async load(): Promise<ImageBitmap> {
    // Stills are cheap enough to hold at native size unless they are enormous.
    //
    // Never for an RGBE frame, though: downscaling resamples the alpha channel,
    // which is a shared exponent rather than a colour, and the average of two
    // exponents describes neither neighbour. It has to arrive whole and be
    // unpacked to float before anything interpolates it.
    const cap = Math.max(this.ctx.maxCacheWidth, this.ctx.viewportWidth * 2);
    const downscale = !this.isHdr && this.item.width > cap;
    return loadBitmap(this.item.url, downscale ? cap : undefined);
  }

  async fullRes(): Promise<TexSource | null> {
    if (!this.full) {
      try {
        this.full = await loadBitmap(this.item.url);
      } catch {
        return null;
      }
    }
    // Through texFor, so an HDR still is unpacked here too — returning the raw
    // bitmap would hand RGBE bytes to the shader as though they were colour.
    return this.texFor(-1, this.full);
  }

  dispose(): void {
    this.full?.close?.();
    this.full = null;
    super.dispose();
  }
}

/** A pre-extracted image sequence, or PDF pages rasterised at ingest. */
export class SequenceSource extends BitmapCacheSource {
  protected limit: number;

  constructor(
    item: ReviewItem,
    private ctx: SourceContext,
  ) {
    super(item, item.width, item.height, Math.max(1, item.frameUrls?.length ?? item.frameCount));

    // Hold the whole shot if it will fit, and let the ledger say whether it
    // does. A fixed count cap cannot: what a frame costs varies twelvefold
    // between an ordinary one and an HDR one, so any number picked here is
    // either wasteful or — as 48 was against a 49-frame shot — permanently one
    // frame short, re-decoding that frame on every pass round the loop.
    this.limit = this.frameCount;
  }

  protected async load(frame: number): Promise<ImageBitmap> {
    const url = this.item.frameUrls?.[frame];
    if (!url) throw new Error(`sequence: no url for frame ${frame}`);
    // Never for RGBE — see StillSource.load. A resampled exponent is not a
    // dimmer pixel, it is a different one.
    if (this.isHdr) return loadBitmap(url);
    const cap = Math.min(this.ctx.maxCacheWidth, Math.max(640, this.ctx.viewportWidth * 2));
    return loadBitmap(url, this.item.width > cap ? cap : undefined);
  }

  async fullRes(frame: number): Promise<TexSource | null> {
    const url = this.item.frameUrls?.[frame];
    if (!url) return null;
    try {
      // Through texFor, so an HDR frame is unpacked here too — handing back the
      // raw bitmap would feed RGBE bytes to the shader as though they were
      // colour, which reads as a dark, blotchy mess.
      return this.texFor(frame, await loadBitmap(url));
    } catch {
      return null;
    }
  }
}
