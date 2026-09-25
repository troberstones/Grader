import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { reviewMedia, reviewStrokes, submissions } from "@/db/schema";
import { decodeStroke, rgbeToFloat, RGBE_TRANSFER, type Stroke } from "@grader/art-review/core";
import { isDot, strokesToSvg } from "./stroke-svg";

const run = promisify(execFile);

/**
 * Annotated frames for one student's submissions, rendered to JPEG for email.
 *
 * Rendered here on the server from the stored strokes, not captured from the
 * reviewer: sending to a whole class must not depend on someone having opened
 * each student's work in a browser first. The artwork is the web-safe
 * derivative the reviewer itself shows (review_media), untouched by any view
 * adjustments — no zoom, exposure, flips or guides.
 */

export interface RenderedFrame {
  cid: string;
  filename: string;
  /** "render.mp4 · frame 142 · 00:05:22" */
  label: string;
  content: Buffer;
  contentType: "image/jpeg";
  width: number;
  height: number;
}

export interface FramesResult {
  frames: RenderedFrame[];
  /** Things the professor should know were left out, e.g. PDF pages. */
  warnings: string[];
  /** Frames skipped because their only marks were dots. */
  dotOnlyFrames: number;
}

/**
 * Gmail rejects anything over 25 MB, and base64 grows attachments by a third.
 * 12 MB of JPEG leaves room for that and for the message itself.
 */
const DEFAULT_BUDGET_BYTES = 12 * 1024 * 1024;

/**
 * Tried in order until the whole set fits the budget. The first step is sharp
 * enough to zoom into on a laptop; the last still reads on a phone.
 */
const COMPRESSION_STEPS: { width: number; quality: number }[] = [
  { width: 1600, quality: 82 },
  { width: 1280, quality: 74 },
  { width: 1024, quality: 66 },
  { width: 800, quality: 60 },
  { width: 640, quality: 52 },
];

type MediaRow = typeof reviewMedia.$inferSelect;

export async function renderAnnotatedFrames(
  assignmentId: number,
  studentId: number,
  opts: { budgetBytes?: number } = {},
): Promise<FramesResult> {
  const sharp = (await import("sharp")).default;
  const warnings: string[] = [];
  let dotOnlyFrames = 0;

  const subs = await db
    .select()
    .from(submissions)
    .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.studentId, studentId)))
    .orderBy(asc(submissions.id));

  // Each master is the composited frame at the largest size we would send,
  // kept lossless so every compression step starts from the same pixels.
  const masters: { label: string; slug: string; png: Buffer }[] = [];

  for (const sub of subs) {
    const rows = await db
      .select()
      .from(reviewStrokes)
      .where(and(eq(reviewStrokes.itemId, `sub:${sub.id}`), isNull(reviewStrokes.deletedAt)))
      .orderBy(asc(reviewStrokes.seq));
    if (rows.length === 0) continue;

    const media = await db
      .select()
      .from(reviewMedia)
      .where(eq(reviewMedia.submissionId, sub.id))
      .orderBy(asc(reviewMedia.idx));
    if (media.some((m) => m.status === "failed")) {
      warnings.push(`${sub.fileName}: the file could not be processed, so its annotations were left out`);
      continue;
    }

    const proxy = media.find((m) => m.variant === "proxy");
    const composite = media.find((m) => m.variant === "composite");
    const frameRows = media.filter((m) => m.variant === "frame");
    const original = media.find((m) => m.variant === "original");
    const primary = proxy ?? composite ?? frameRows[0] ?? original;
    if (!primary) continue;

    if (primary.kind === "pages") {
      // pdf.js renders pages in the browser; nothing on this server can
      // rasterise a PDF page to draw on.
      warnings.push(`${sub.fileName}: annotations on PDF pages aren't included in email yet`);
      continue;
    }

    const W = primary.width ?? 1600;
    const H = primary.height ?? 900;

    const strokes: Stroke[] = [];
    for (const r of rows) {
      try {
        strokes.push(
          decodeStroke(new Uint8Array(r.data as Buffer), {
            id: r.id,
            frameIn: r.frameIn,
            frameOut: r.frameOut,
            authorId: r.authorId,
          }),
        );
      } catch {
        // An unreadable stroke is skipped rather than sinking the whole email.
      }
    }

    const allKeys = [...new Set(strokes.map((s) => s.frameIn))].sort((a, b) => a - b);
    const keyFrames = [...new Set(strokes.filter((s) => !isDot(s, W, H)).map((s) => s.frameIn))].sort((a, b) => a - b);
    dotOnlyFrames += allKeys.filter((k) => !keyFrames.includes(k)).length;

    const fps = primary.fps ?? sub.fps ?? null;
    const isVideo = primary.kind === "video";
    const isSequence = frameRows.length > 0;

    for (const frame of keyFrames) {
      const visible = strokes.filter((s) => s.frameIn <= frame && frame <= s.frameOut);

      let base: Buffer;
      try {
        if (isVideo) {
          base = await extractVideoFrame(primary, frame, fps ?? 24);
        } else if (isSequence) {
          const row = frameRows[Math.min(frame, frameRows.length - 1)];
          base = await loadStill(row);
        } else {
          base = await loadStill(primary);
        }
      } catch (err) {
        warnings.push(`${sub.fileName}: couldn't read frame ${frame} (${err instanceof Error ? err.message : String(err)})`);
        continue;
      }

      const top = COMPRESSION_STEPS[0].width;
      const resized = await sharp(base)
        .flatten({ background: "#ffffff" })
        .resize({ width: top, withoutEnlargement: true })
        .png({ compressionLevel: 1 })
        .toBuffer({ resolveWithObject: true });
      const { width: outW, height: outH } = resized.info;

      const svg = strokesToSvg(visible, W, H, outW, outH);
      const layers: { input: Buffer; blend?: "multiply" }[] = [];
      if (svg.highlight) layers.push({ input: Buffer.from(svg.highlight), blend: "multiply" });
      if (svg.normal) layers.push({ input: Buffer.from(svg.normal) });

      const png = await sharp(resized.data).composite(layers).png({ compressionLevel: 1 }).toBuffer();

      const single = !isVideo && !isSequence;
      const where = single
        ? ""
        : ` · frame ${frame}${isVideo && fps ? ` · ${timecode(frame, fps)}` : ""}`;
      masters.push({
        label: `${sub.fileName}${where}`,
        slug: `${sub.id}-${frame}`,
        png,
      });
    }
  }

  const budget = opts.budgetBytes ?? DEFAULT_BUDGET_BYTES;
  let encoded: RenderedFrame[] = [];
  for (const step of COMPRESSION_STEPS) {
    encoded = [];
    for (const m of masters) {
      const out = await sharp(m.png)
        .resize({ width: step.width, withoutEnlargement: true })
        .jpeg({ quality: step.quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      encoded.push({
        cid: `frame-${m.slug}@grader`,
        filename: `frame-${m.slug}.jpg`,
        label: m.label,
        content: out.data,
        contentType: "image/jpeg",
        width: out.info.width,
        height: out.info.height,
      });
    }
    const total = encoded.reduce((sum, f) => sum + f.content.length, 0);
    if (total <= budget) break;
  }

  // Still over at the smallest step: drop frames from the end rather than
  // send something the student's mail server will bounce.
  let total = encoded.reduce((sum, f) => sum + f.content.length, 0);
  let dropped = 0;
  while (total > budget && encoded.length > 0) {
    total -= encoded.pop()!.content.length;
    dropped++;
  }
  if (dropped > 0) {
    warnings.push(`${dropped} annotated frame${dropped === 1 ? "" : "s"} didn't fit in one email and were left out`);
  }

  return { frames: encoded, warnings, dotOnlyFrames };
}

/** Same format as the reviewer's timeline (Timeline.tsx), so the numbers match what the professor saw. */
function timecode(frame: number, fps: number): string {
  const total = frame / fps;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const f = Math.round(frame % fps);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

function resolveStorage(p: string): string {
  const root = process.cwd();
  const absolute = path.resolve(root, p);
  if (!absolute.startsWith(path.join(root, "storage"))) throw new Error("media path outside storage");
  return absolute;
}

/**
 * The frame the reviewer shows at `frame`.
 *
 * Not the same seek arithmetic as the reviewer's (video-element.ts seeks to
 * the middle of the frame): a browser shows the frame *covering* a time, but
 * ffmpeg's input seek returns the first frame *starting at or after* it, so a
 * mid-frame time lands one frame late. Half a frame early lands on `frame`
 * whichever way the float rounds.
 */
async function extractVideoFrame(media: MediaRow, frame: number, fps: number): Promise<Buffer> {
  const time = Math.max(0, (frame - 0.5) / fps).toFixed(4);
  const { stdout } = await run(
    process.env.FFMPEG_PATH || "ffmpeg",
    ["-v", "error", "-ss", time, "-i", resolveStorage(media.path), "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1"],
    { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 },
  );
  if (!stdout.length) throw new Error("no frame decoded");
  return stdout;
}

/**
 * A still derivative as an ordinary 8-bit sRGB image. HDR stills are stored
 * RGBE-packed (core/rgbe.ts) and would read as noise if handed to sharp as-is,
 * so they are decoded and shown the way the reviewer shows them at its
 * default exposure: linear, clamped, sRGB-encoded.
 */
async function loadStill(media: MediaRow): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const file = resolveStorage(media.path);
  if (media.colorTransfer !== RGBE_TRANSFER) return sharp(file, { limitInputPixels: false }).toBuffer();

  const { data, info } = await sharp(file, { limitInputPixels: false }).raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const out = Buffer.alloc(n * 3);
  const rgbe = new Uint8Array(data.buffer, data.byteOffset, data.length);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = rgbeToFloat(rgbe, i * info.channels);
    out[i * 3] = toSrgbByte(r);
    out[i * 3 + 1] = toSrgbByte(g);
    out[i * 3 + 2] = toSrgbByte(b);
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).png({ compressionLevel: 1 }).toBuffer();
}

function toSrgbByte(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}
