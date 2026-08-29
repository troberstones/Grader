import { BitmapCacheSource, loadBitmap } from "./bitmap-cache";
import type { LayerDraw, LayeredFrameSource, SourceContext, TexSource } from "./types";
import type { LayerManifest, ReviewItem } from "../core/types";

/**
 * PSD/PSB with a live layer stack.
 *
 * The manifest (tree, bounds, blend modes) is cheap and always loaded. Layer
 * rasters are fetched only when a layer is actually shown — a 4000×4000 file
 * with 150 layers would otherwise be gigabytes of PNG for layers nobody opens.
 * Each raster is trimmed to its own bounds, so most are a fraction of canvas.
 */
export class LayeredSource extends BitmapCacheSource implements LayeredFrameSource {
  protected limit = 1;
  private layerBitmaps = new Map<string, ImageBitmap>();
  private layerLoading = new Set<string>();
  private layerFailed = new Set<string>();
  private manifestData: LayerManifest | null = null;

  constructor(
    item: ReviewItem,
    private ctx: SourceContext,
  ) {
    super(item, item.width, item.height, 1);
  }

  protected async init(): Promise<void> {
    if (!this.item.layersUrl) return;
    try {
      const res = await fetch(this.item.layersUrl);
      if (res.ok) {
        this.manifestData = (await res.json()) as LayerManifest;
        this.emit();
      }
    } catch {
      // Composite-only is a perfectly good degraded mode.
    }
  }

  protected async load(): Promise<ImageBitmap> {
    const cap = Math.max(this.ctx.maxCacheWidth, this.ctx.viewportWidth * 2);
    return loadBitmap(this.item.url, this.item.width > cap ? cap : undefined);
  }

  manifest(): LayerManifest | null {
    return this.manifestData;
  }

  requestLayer(id: string): void {
    if (
      this.layerBitmaps.has(id) ||
      this.layerLoading.has(id) ||
      this.layerFailed.has(id) ||
      !this.manifestData
    ) {
      return;
    }
    const layer = this.manifestData.layers.find((l) => l.id === id);
    if (!layer?.rasterUrl) return;

    this.layerLoading.add(id);
    void loadBitmap(layer.rasterUrl)
      .then((bmp) => {
        if (this.disposed) {
          bmp.close?.();
          return;
        }
        this.layerBitmaps.set(id, bmp);
        this.version++;
        this.emit();
      })
      .catch(() => {
        this.layerFailed.add(id);
      })
      .finally(() => {
        this.layerLoading.delete(id);
      });
  }

  /**
   * Visible layers bottom-to-top, with their rasters. Groups are skipped —
   * their children carry the pixels. A layer whose raster has not arrived yet
   * is simply omitted this frame; it appears when it loads.
   */
  layerStack(visible: Record<string, boolean>, solo: string | null): LayerDraw[] {
    const m = this.manifestData;
    if (!m) return [];

    const out: LayerDraw[] = [];
    for (const layer of m.layers) {
      if (layer.isGroup || !layer.rasterUrl) continue;

      const shown = solo
        ? layer.id === solo
        : (visible[layer.id] ?? layer.visible) && this.groupVisible(layer.parentId, visible, solo);
      if (!shown) continue;

      this.requestLayer(layer.id);
      const bmp = this.layerBitmaps.get(layer.id);
      if (!bmp) continue;

      const [l, t, r, b] = layer.bounds;
      out.push({
        layer,
        tex: { type: "bitmap", bitmap: bmp, width: bmp.width, height: bmp.height },
        x: l,
        y: t,
        w: Math.max(1, r - l),
        h: Math.max(1, b - t),
      });
    }
    return out;
  }

  /**
   * Whether the current visibility state would show anything at all, ignoring
   * whether the layer's raster has actually finished loading yet. Distinct
   * from `layerStack(...).length > 0`, which also goes empty mid-load — the
   * two need to be told apart so an in-flight fetch doesn't look the same as
   * a reviewer who switched every layer off.
   */
  anyLayerVisible(visible: Record<string, boolean>, solo: string | null): boolean {
    const m = this.manifestData;
    if (!m) return false;
    for (const layer of m.layers) {
      if (layer.isGroup) continue;
      const shown = solo
        ? layer.id === solo
        : (visible[layer.id] ?? layer.visible) && this.groupVisible(layer.parentId, visible, solo);
      if (shown) return true;
    }
    return false;
  }

  /** A layer inside a hidden group is hidden, however its own flag reads. */
  private groupVisible(
    parentId: string | null,
    visible: Record<string, boolean>,
    solo: string | null,
  ): boolean {
    if (solo) return true;
    let id = parentId;
    let guard = 0;
    while (id && guard++ < 64) {
      const group = this.manifestData?.layers.find((l) => l.id === id);
      if (!group) return true;
      if (!(visible[group.id] ?? group.visible)) return false;
      id = group.parentId;
    }
    return true;
  }

  /** Layers whose rasters are still in flight, for the panel's loading state. */
  pendingLayers(): string[] {
    return [...this.layerLoading];
  }

  async fullRes(): Promise<TexSource | null> {
    try {
      const bmp = await loadBitmap(this.item.url);
      return { type: "bitmap", bitmap: bmp, width: bmp.width, height: bmp.height };
    } catch {
      return null;
    }
  }

  dispose(): void {
    for (const b of this.layerBitmaps.values()) b.close?.();
    this.layerBitmaps.clear();
    super.dispose();
  }
}
