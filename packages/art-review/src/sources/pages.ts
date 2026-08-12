import { BitmapCacheSource } from "./bitmap-cache";
import type { SourceContext, TexSource } from "./types";
import type { ReviewItem } from "../core/types";

/**
 * PDF pages, rendered client-side with pdf.js.
 *
 * Server-side rasterising would be preferable (it would make a PDF just another
 * image sequence) but this machine has no poppler, ghostscript or ImageMagick,
 * and pdf.js needs a canvas to run headless. So: the browser renders, and the
 * worker is served as a static file rather than being bundled — deterministic,
 * and immune to bundler changes.
 */

type PdfModule = typeof import("pdfjs-dist");
type PdfDocument = Awaited<ReturnType<PdfModule["getDocument"]>["promise"]>;

let pdfModule: Promise<PdfModule> | null = null;

function loadPdfjs(workerUrl: string): Promise<PdfModule> {
  if (!pdfModule) {
    pdfModule = import("pdfjs-dist").then((m) => {
      m.GlobalWorkerOptions.workerSrc = workerUrl;
      return m;
    });
  }
  return pdfModule;
}

export class PageSource extends BitmapCacheSource {
  protected limit = 12;
  private doc: PdfDocument | null = null;
  private pageSizes = new Map<number, { width: number; height: number }>();

  constructor(
    item: ReviewItem,
    private ctx: SourceContext,
  ) {
    super(item, item.width, item.height, Math.max(1, item.frameCount));
  }

  protected async init(): Promise<void> {
    const pdfjs = await loadPdfjs(this.ctx.pdfWorkerUrl);
    const task = pdfjs.getDocument({
      url: this.item.url,
      // Fonts and cmaps are only needed for text rendering fidelity; without
      // them exotic PDFs render boxes instead of glyphs.
      cMapUrl: "/pdf-cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdf-fonts/",
    });
    this.doc = await task.promise;
  }

  private targetScale(pageWidth: number): number {
    // Render with headroom so zooming into a page stays legible without a
    // re-render, but stay under the cache ceiling.
    const target = Math.min(this.ctx.maxCacheWidth, Math.max(1400, this.ctx.viewportWidth * 2));
    return Math.min(4, Math.max(0.5, target / pageWidth));
  }

  protected async load(frame: number): Promise<ImageBitmap> {
    await this.ready();
    if (!this.doc) throw new Error("pdf: document failed to open");
    const page = await this.doc.getPage(frame + 1);
    const base = page.getViewport({ scale: 1 });
    this.pageSizes.set(frame, { width: base.width, height: base.height });
    const viewport = page.getViewport({ scale: this.targetScale(base.width) });

    const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("pdf: no 2d context");
    // PDFs assume paper. Without this, transparent regions composite to black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    } as Parameters<typeof page.render>[0]).promise;

    page.cleanup();
    return canvas.transferToImageBitmap();
  }

  async fullRes(frame: number): Promise<TexSource | null> {
    try {
      await this.ready();
      if (!this.doc) return null;
      const page = await this.doc.getPage(frame + 1);
      const viewport = page.getViewport({ scale: 4 });
      const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      } as Parameters<typeof page.render>[0]).promise;
      page.cleanup();
      const bitmap = canvas.transferToImageBitmap();
      return { type: "bitmap", bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.doc?.destroy?.();
    this.doc = null;
    super.dispose();
  }
}
