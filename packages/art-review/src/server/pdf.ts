import { readFile } from "node:fs/promises";

/**
 * Page count only.
 *
 * Rasterising server-side would be preferable — a PDF would become an ordinary
 * image sequence and the client would need no PDF code at all — but this
 * machine has no poppler, ghostscript or ImageMagick, and pdf.js cannot render
 * headless without a native canvas. So pages render in the browser and only the
 * count comes from here.
 */
export async function pdfPageCount(input: string): Promise<number> {
  const data = await readFile(input);

  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(data),
      // Parsing needs neither worker nor fonts.
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
    }).promise;
    const n = doc.numPages;
    await doc.destroy();
    if (n > 0) return n;
  } catch {
    // Fall through to the structural scan.
  }

  // Crude but dependency-free: count page objects in the raw file. Good enough
  // to build a timeline; the real count arrives when pdf.js opens it client-side.
  const text = data.toString("latin1");
  const byCount = /\/Count\s+(\d+)/.exec(text);
  if (byCount) {
    const n = Number(byCount[1]);
    if (n > 0 && n < 10000) return n;
  }
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return Math.max(1, matches?.length ?? 1);
}
