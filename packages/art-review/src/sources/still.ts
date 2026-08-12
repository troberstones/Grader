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
    const cap = Math.max(this.ctx.maxCacheWidth, this.ctx.viewportWidth * 2);
    return loadBitmap(this.item.url, this.item.width > cap ? cap : undefined);
  }

  async fullRes(): Promise<TexSource | null> {
    if (!this.full) {
      try {
        this.full = await loadBitmap(this.item.url);
      } catch {
        return null;
      }
    }
    return { type: "bitmap", bitmap: this.full, width: this.full.width, height: this.full.height };
  }

  dispose(): void {
    this.full?.close?.();
    this.full = null;
    super.dispose();
  }
}

/** A pre-extracted image sequence, or PDF pages rasterised at ingest. */
export class SequenceSource extends BitmapCacheSource {
  protected limit = 48;

  constructor(
    item: ReviewItem,
    private ctx: SourceContext,
  ) {
    super(item, item.width, item.height, Math.max(1, item.frameUrls?.length ?? item.frameCount));
  }

  protected async load(frame: number): Promise<ImageBitmap> {
    const url = this.item.frameUrls?.[frame];
    if (!url) throw new Error(`sequence: no url for frame ${frame}`);
    const cap = Math.min(this.ctx.maxCacheWidth, Math.max(640, this.ctx.viewportWidth * 2));
    return loadBitmap(url, this.item.width > cap ? cap : undefined);
  }

  async fullRes(frame: number): Promise<TexSource | null> {
    const url = this.item.frameUrls?.[frame];
    if (!url) return null;
    try {
      const bmp = await loadBitmap(url);
      return { type: "bitmap", bitmap: bmp, width: bmp.width, height: bmp.height };
    } catch {
      return null;
    }
  }
}
