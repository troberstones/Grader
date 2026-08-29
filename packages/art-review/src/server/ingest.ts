import { execFile, spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { floatsToRgbe, RGBE_TRANSFER } from "../core/rgbe";
import type { DecodedExr } from "./exr";

const run = promisify(execFile);

/**
 * Runs ffmpeg with `-progress pipe:1`, reporting 0-100 against `totalSeconds`
 * as `out_time_ms` lines arrive. Falls back to a bare run (no progress calls)
 * when `onProgress` isn't given, since parsing progress lines is pointless
 * overhead for e.g. the smoke test and any future caller that doesn't need it.
 */
function runFfmpeg(
  ffmpeg: string,
  args: string[],
  totalSeconds: number,
  onProgress?: (stage: string, pct?: number) => void,
  stage = "Generating preview",
): Promise<void> {
  if (!onProgress) {
    return run(ffmpeg, ["-y", ...args], { maxBuffer: 16 * 1024 * 1024 }).then(() => undefined);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ["-y", "-progress", "pipe:1", "-nostats", ...args]);
    let stderr = "";
    let buffered = "";

    child.stdout.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        const eq = line.indexOf("=");
        if (eq === -1) continue;
        const key = line.slice(0, eq);
        const value = line.slice(eq + 1);
        if (key === "out_time_ms" && totalSeconds > 0) {
          const pct = Math.min(99, Math.max(0, Math.round((Number(value) / 1_000_000 / totalSeconds) * 100)));
          onProgress(stage, pct);
        } else if (key === "progress" && value === "end") {
          onProgress(stage, 100);
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${ffmpeg} exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

/**
 * Ingest: never ask the browser to decode an arbitrary file.
 *
 * Students hand in .mov (often ProRes or HEVC), .avi, .tiff and .psd — none of
 * which a browser will reliably display. Everything gets a web-safe derivative
 * at upload, and video gets an all-intra proxy so random access is free.
 */

export interface ProbeResult {
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  duration: number;
  codec: string;
  pixFmt: string;
  colorPrimaries?: string;
  colorTransfer?: string;
  hasAudio: boolean;
}

export interface Derivative {
  variant: "original" | "proxy" | "poster" | "page" | "composite" | "layer" | "frame";
  idx: number;
  path: string;
  mime: string;
  width?: number;
  height?: number;
  fps?: number;
  frameCount?: number;
  duration?: number;
  colorPrimaries?: string;
  colorTransfer?: string;
}

export interface IngestOptions {
  /** Where derivatives are written. */
  outDir: string;
  /** Basename (no extension) for generated files. */
  baseName: string;
  /** Cap proxy resolution. */
  maxWidth?: number;
  /**
   * Keyframe roughly every second instead of ffmpeg's multi-second default,
   * so scrubbing never has to decode far to land on an exact frame. A true
   * all-intra encode (every frame a keyframe) was tried first and rejected:
   * it multiplied bitrate 3-6x, and large proxies then failed to load in the
   * browser under real network conditions (slow/stalled transfers reported
   * as a generic demuxer error, not a size problem) — see BUGS.md. A ~1s
   * keyframe interval keeps worst-case seek latency imperceptible (decode a
   * few dozen frames, not a whole GOP) while keeping file size sane.
   */
  allIntra?: boolean;
  ffmpegPath?: string;
  ffprobePath?: string;
  /** Skip work when the derivative already exists. */
  force?: boolean;
  /** Reports a short human-readable stage label, and 0-100 where progress is measurable (video transcode only). */
  onProgress?: (stage: string, pct?: number) => void;
}

const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv", ".mpg", ".mpeg"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const CONVERT_EXT = new Set([".tif", ".tiff", ".dpx", ".tga"]);
/**
 * EXR is its own path, not part of CONVERT_EXT: sharp cannot read it at all
 * ("Input file contains unsupported image format"), and the whole reason to
 * accept it is the dynamic range, which a convert-to-PNG step would flatten.
 */
const HDR_EXT = new Set([".exr"]);

export function classify(
  fileName: string,
): "video" | "image" | "convert" | "hdr" | "psd" | "pdf" | null {
  const ext = path.extname(fileName).toLowerCase();
  if (VIDEO_EXT.has(ext)) return "video";
  if (IMAGE_EXT.has(ext)) return "image";
  if (HDR_EXT.has(ext)) return "hdr";
  if (CONVERT_EXT.has(ext)) return "convert";
  if (ext === ".psd" || ext === ".psb") return "psd";
  if (ext === ".pdf") return "pdf";
  return null;
}

export async function probe(input: string, ffprobePath = "ffprobe"): Promise<ProbeResult> {
  const { stdout } = await run(ffprobePath, [
    "-v", "error",
    "-show_entries",
    "stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames,duration,pix_fmt,color_primaries,color_transfer",
    "-show_entries", "format=duration",
    "-of", "json",
    input,
  ], { maxBuffer: 8 * 1024 * 1024 });

  const data = JSON.parse(stdout) as {
    streams?: Array<Record<string, string | number>>;
    format?: { duration?: string };
  };
  const streams = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  if (!v) throw new Error("no video stream");

  const fps = parseRate(String(v.avg_frame_rate ?? "")) || parseRate(String(v.r_frame_rate ?? "")) || 24;
  const duration =
    Number(v.duration) || Number(data.format?.duration) || 0;

  // nb_frames is missing from plenty of containers; derive it rather than
  // decoding the whole file with -count_frames.
  let frameCount = Number(v.nb_frames) || 0;
  if (!frameCount && duration && fps) frameCount = Math.round(duration * fps);

  return {
    width: Number(v.width) || 0,
    height: Number(v.height) || 0,
    fps,
    frameCount: Math.max(1, frameCount),
    duration,
    codec: String(v.codec_name ?? ""),
    pixFmt: String(v.pix_fmt ?? ""),
    colorPrimaries: v.color_primaries ? String(v.color_primaries) : undefined,
    colorTransfer: v.color_transfer ? String(v.color_transfer) : undefined,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
  };
}

function parseRate(r: string): number {
  const [num, den] = r.split("/").map(Number);
  if (!num || !den) return 0;
  const v = num / den;
  return Number.isFinite(v) && v > 0 && v < 1000 ? v : 0;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Transcode to a scrub-friendly H.264 proxy.
 *
 * A short, fixed keyframe interval (~1s) means decoding frame 87 walks back
 * at most a few dozen frames, not a whole multi-second GOP — reverse decode
 * and the <video> fallback's exact-frame seeking both stay cheap. A true
 * all-intra encode (every frame a keyframe, `-g 1`) was tried first: it
 * quadrupled bitrate, and the resulting large proxies then failed to load in
 * the browser over a real (non-LAN) network — a stalled/slow transfer of a
 * multi-hundred-MB file surfaces as a generic demuxer error, not a timeout,
 * which is exactly what made this look like file corruption at first. See
 * BUGS.md for the investigation.
 */
export async function makeVideoProxy(
  input: string,
  opts: IngestOptions & { probe?: ProbeResult },
): Promise<Derivative> {
  const ffmpeg = opts.ffmpegPath ?? "ffmpeg";
  await mkdir(opts.outDir, { recursive: true });
  const out = path.join(opts.outDir, `${opts.baseName}.proxy.mp4`);

  const info = opts.probe ?? (await probe(input, opts.ffprobePath));
  const maxWidth = opts.maxWidth ?? 1920;

  if (!opts.force && (await exists(out))) {
    return proxyDerivative(out, info, maxWidth);
  }

  const args = [
    "-i", input,
    "-map", "0:v:0",
    "-c:v", "libx264",
    "-crf", "18",
    "-preset", "fast",
    "-pix_fmt", "yuv420p",
    "-vf", `scale='min(${maxWidth},iw)':-2:flags=lanczos`,
    "-movflags", "+faststart",
  ];
  if (opts.allIntra !== false) {
    const keyframeInterval = Math.max(1, Math.round(info.fps || 24));
    args.push("-g", String(keyframeInterval), "-bf", "0");
  }
  if (info.hasAudio) args.push("-map", "0:a:0?", "-c:a", "aac", "-b:a", "160k");
  else args.push("-an");
  args.push(out);

  opts.onProgress?.("Generating preview", 0);
  await runFfmpeg(ffmpeg, args, info.duration, opts.onProgress, "Generating preview");
  return proxyDerivative(out, info, maxWidth);
}

function proxyDerivative(out: string, info: ProbeResult, maxWidth: number): Derivative {
  const scale = Math.min(1, maxWidth / Math.max(1, info.width));
  const w = Math.round(info.width * scale);
  return {
    variant: "proxy",
    idx: 0,
    path: out,
    mime: "video/mp4",
    // -2 keeps height even; mirror that so stored dimensions match the file.
    width: w - (w % 2),
    height: Math.round(info.height * scale) - (Math.round(info.height * scale) % 2),
    fps: info.fps,
    frameCount: info.frameCount,
    duration: info.duration,
    colorPrimaries: info.colorPrimaries,
    colorTransfer: info.colorTransfer,
  };
}

export async function makePoster(
  input: string,
  opts: IngestOptions,
): Promise<Derivative | null> {
  const ffmpeg = opts.ffmpegPath ?? "ffmpeg";
  await mkdir(opts.outDir, { recursive: true });
  const out = path.join(opts.outDir, `${opts.baseName}.poster.jpg`);
  if (!opts.force && (await exists(out))) {
    return { variant: "poster", idx: 0, path: out, mime: "image/jpeg" };
  }
  opts.onProgress?.("Generating thumbnail");
  try {
    await run(ffmpeg, [
      "-y", "-i", input,
      "-frames:v", "1",
      "-vf", "scale='min(640,iw)':-2",
      "-q:v", "4",
      out,
    ]);
    return { variant: "poster", idx: 0, path: out, mime: "image/jpeg" };
  } catch {
    return null;
  }
}

/**
 * Normalise a still image.
 *
 * Matrix/TRC ICC profiles (sRGB, AdobeRGB, Display P3, ProPhoto — nearly every
 * RGB working space) could be applied in the shader, but converting once at
 * ingest is simpler and covers LUT-based profiles too, which cannot go in a
 * shader at all. The original is always kept.
 */
export async function normaliseImage(
  input: string,
  opts: IngestOptions & { toColourSpace?: "srgb" | "p3" },
): Promise<Derivative> {
  const sharp = (await import("sharp")).default;
  await mkdir(opts.outDir, { recursive: true });
  const out = path.join(opts.outDir, `${opts.baseName}.view.png`);

  const image = sharp(input, { limitInputPixels: 1_000_000_000, unlimited: true });
  const meta = await image.metadata();

  if (!opts.force && (await exists(out))) {
    return {
      variant: "composite",
      idx: 0,
      path: out,
      mime: "image/png",
      width: meta.width,
      height: meta.height,
    };
  }

  const maxWidth = opts.maxWidth ?? 4096;
  let pipeline = image;
  if (meta.icc) pipeline = pipeline.toColourspace("srgb");
  if ((meta.width ?? 0) > maxWidth) pipeline = pipeline.resize({ width: maxWidth });

  const info = await pipeline.png({ compressionLevel: 6 }).toFile(out);
  return {
    variant: "composite",
    idx: 0,
    path: out,
    mime: "image/png",
    width: info.width,
    height: info.height,
  };
}

/**
 * EXR → RGBE PNG, preserving everything above 1.0.
 *
 * The pixel format is read from the file and handed straight back to ffmpeg
 * rather than being chosen. Asking for a format that differs from the decoded
 * one — even only by an added alpha plane — routes the frame through swscale,
 * which silently clamps float to [0,1]. That failure is invisible: you get a
 * plausible image with the entire highlight range gone.
 */
export async function makeHdrPng(
  input: string,
  opts: IngestOptions,
): Promise<Derivative> {
  const sharp = (await import("sharp")).default;
  const { readFile } = await import("node:fs/promises");
  const { decodeExr } = await import("./exr");
  await mkdir(opts.outDir, { recursive: true });
  const out = path.join(opts.outDir, `${opts.baseName}.rgbe.png`);

  const file = await readFile(input);
  const exr = decodeExr(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  const { width, height } = exr;

  if (!opts.force && (await exists(out))) {
    return hdrDerivative(out, width, height, exr.chromaticities);
  }

  // Interleaved RGBA out of the decoder; the packer wants planes.
  //
  // Rows are also reversed on the way. The decoder hands back scanlines in GL
  // texture order — first row at the bottom — because it exists to fill a
  // three.js DataTexture. A PNG is the other way up, so writing them straight
  // through produces a derivative that is upside down in every viewer,
  // including this one. Doing it here rather than with a shader flip keeps the
  // file on disk honest: open it in anything and it is the right way up.
  const n = width * height;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    const from = (height - 1 - y) * width;
    const to = y * width;
    for (let x = 0; x < width; x++) {
      const s = (from + x) * 4;
      const d = to + x;
      r[d] = exr.data[s];
      g[d] = exr.data[s + 1];
      b[d] = exr.data[s + 2];
    }
  }

  const rgbe = new Uint8Array(n * 4);
  floatsToRgbe(r, g, b, rgbe);

  await sharp(Buffer.from(rgbe.buffer, rgbe.byteOffset, rgbe.length), {
    raw: { width, height, channels: 4 },
  })
    // No resizing, ever: resampling RGBE means averaging exponents, which is
    // not a colour operation and produces garbage. If a cap is needed it has
    // to happen in float, before the pack.
    .png({ compressionLevel: 6 })
    .toFile(out);

  return hdrDerivative(out, width, height, exr.chromaticities);
}

/**
 * Name the working space from the chromaticities the file declares, so the
 * renderer is told rather than left to assume sRGB. A render in ACES primaries
 * shown as sRGB is not subtly off — the gamut is a different shape.
 */
function primariesOf(c: DecodedExr["chromaticities"]): string | undefined {
  if (!c) return undefined;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.001;
  const match = (rx: number, ry: number, gx: number, gy: number, bx: number, by: number) =>
    near(c.redX, rx) && near(c.redY, ry) &&
    near(c.greenX, gx) && near(c.greenY, gy) &&
    near(c.blueX, bx) && near(c.blueY, by);

  if (match(0.7347, 0.2653, 0.0, 1.0, 0.0001, -0.077)) return "aces2065-1";
  if (match(0.713, 0.293, 0.165, 0.83, 0.128, 0.044)) return "acescg";
  if (match(0.64, 0.33, 0.3, 0.6, 0.15, 0.06)) return "bt709";
  if (match(0.68, 0.32, 0.265, 0.69, 0.15, 0.06)) return "display-p3";
  return "unknown";
}

function hdrDerivative(
  out: string,
  width: number,
  height: number,
  chromaticities: DecodedExr["chromaticities"],
): Derivative {
  return {
    variant: "composite",
    idx: 0,
    path: out,
    mime: "image/png",
    width,
    height,
    colorTransfer: RGBE_TRANSFER,
    colorPrimaries: primariesOf(chromaticities),
  };
}

/**
 * The frame number in a rendered filename: the last run of digits before the
 * extension. Renders come off a farm as name.1001.exr, name_0042.png, or
 * name.v03.0001.exr — the version field is why this takes the *last* run
 * rather than the first.
 */
export function frameNumberOf(fileName: string): number | null {
  const stem = fileName.slice(0, fileName.length - path.extname(fileName).length);
  const match = /(\d+)(?!.*\d)/.exec(stem);
  return match ? Number(match[1]) : null;
}

/**
 * Files in a directory that form one image sequence, in frame order.
 *
 * Sorting is by the parsed frame number, never by name: a sequence that runs
 * past frame 999 sorts 1000 before 999 as a string, and the first frame to
 * cross that boundary would silently reorder the shot.
 */
export async function sequenceFrames(dir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const numbered: Array<{ name: string; n: number }> = [];

  for (const name of await readdir(dir)) {
    if (name.startsWith(".")) continue;
    const kind = classify(name);
    if (kind !== "hdr" && kind !== "image" && kind !== "convert") continue;
    const n = frameNumberOf(name);
    if (n === null) continue;
    numbered.push({ name, n });
  }

  numbered.sort((a, b) => a.n - b.n || a.name.localeCompare(b.name));
  return numbered.map((f) => path.join(dir, f.name));
}

/**
 * A directory of numbered frames as one scrubbable item.
 *
 * Each frame gets the same treatment a lone still would — EXR through the RGBE
 * packer, everything else through sharp — so an HDR sequence keeps its range
 * and a PNG sequence still works. Frames are decoded one at a time on purpose:
 * the EXR decoder is synchronous CPU work, so running four at once would only
 * move the queue, and holding four 1920×1080 float buffers at once is 130 MB
 * for nothing.
 */
export async function ingestSequence(
  dir: string,
  opts: IngestOptions,
): Promise<IngestResult> {
  const warnings: string[] = [];
  const files = await sequenceFrames(dir);
  if (files.length === 0) throw new Error(`no numbered frames in ${dir}`);

  const derivatives: Derivative[] = [];
  let width = 0;
  let height = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const frameOpts = {
      ...opts,
      baseName: `${opts.baseName}.f${String(i).padStart(4, "0")}`,
    };

    let d: Derivative;
    try {
      d = classify(path.basename(file)) === "hdr"
        ? await makeHdrPng(file, frameOpts)
        : await normaliseImage(file, frameOpts);
    } catch (e) {
      // One unreadable frame must not cost the whole shot. Dropping it would
      // shift every later frame's number, so the gap is reported instead and
      // the sequence keeps its original length.
      warnings.push(`frame ${i} (${path.basename(file)}) failed: ${e instanceof Error ? e.message : e}`);
      continue;
    }

    if (!width) {
      width = d.width ?? 0;
      height = d.height ?? 0;
    } else if (d.width !== width || d.height !== height) {
      // Mixed sizes would make the shot jump under a fixed view transform.
      warnings.push(
        `frame ${i} is ${d.width}×${d.height}, not ${width}×${height} — skipped`,
      );
      continue;
    }

    derivatives.push({ ...d, variant: "frame", idx: i });
  }

  if (derivatives.length === 0) throw new Error(`every frame in ${dir} failed to decode`);

  return {
    kind: "sequence",
    derivatives,
    width,
    height,
    // The declared length is what was on disk, so a dropped frame reads as a
    // gap rather than a shorter shot.
    frameCount: files.length,
    fps: 24,
    duration: files.length / 24,
    warnings,
  };
}

/** Everything needed to register one submission's media derivatives. */
export interface IngestResult {
  kind: "video" | "still" | "layered" | "pages" | "sequence";
  derivatives: Derivative[];
  width: number;
  height: number;
  frameCount: number;
  fps: number | null;
  duration: number | null;
  warnings: string[];
}

export async function ingestFile(
  input: string,
  fileName: string,
  opts: IngestOptions,
): Promise<IngestResult> {
  const warnings: string[] = [];

  // A render sequence arrives as a folder, not a file — there is no single
  // thing to classify by extension, so this is checked before anything else.
  const entry = await stat(input).catch(() => null);
  if (entry?.isDirectory()) return ingestSequence(input, opts);

  const kind = classify(fileName);

  if (kind === "video") {
    opts.onProgress?.("Reading video");
    const info = await probe(input, opts.ffprobePath);
    const proxy = await makeVideoProxy(input, { ...opts, probe: info });
    const poster = await makePoster(input, opts);
    return {
      kind: "video",
      derivatives: poster ? [proxy, poster] : [proxy],
      width: proxy.width ?? info.width,
      height: proxy.height ?? info.height,
      frameCount: info.frameCount,
      fps: info.fps,
      duration: info.duration,
      warnings,
    };
  }

  if (kind === "psd") {
    const { ingestPsd } = await import("./psd");
    return ingestPsd(input, opts);
  }

  if (kind === "pdf") {
    // No poppler/ghostscript/ImageMagick on this machine, so pages are
    // rasterised client-side by pdf.js instead. Page count comes from the file.
    const { pdfPageCount } = await import("./pdf");
    const pages = await pdfPageCount(input).catch(() => 1);
    return {
      kind: "pages",
      derivatives: [],
      width: 1275,
      height: 1650,
      frameCount: pages,
      fps: null,
      duration: null,
      warnings: ["PDF pages render in the browser; dimensions are per-page"],
    };
  }

  if (kind === "hdr") {
    const view = await makeHdrPng(input, opts);
    return {
      kind: "still",
      derivatives: [view],
      width: view.width ?? 0,
      height: view.height ?? 0,
      frameCount: 1,
      fps: null,
      duration: null,
      warnings,
    };
  }

  if (kind === "image" || kind === "convert") {
    const view = await normaliseImage(input, opts);
    return {
      kind: "still",
      derivatives: [view],
      width: view.width ?? 0,
      height: view.height ?? 0,
      frameCount: 1,
      fps: null,
      duration: null,
      warnings,
    };
  }

  throw new Error(`unsupported file type: ${fileName}`);
}
